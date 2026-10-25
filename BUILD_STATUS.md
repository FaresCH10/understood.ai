# Understood build status

## Production Hardening Baseline

25 October 2026: production hardening and controlled-release verification started. The
release control surface is [docs/PRODUCTION_RELEASE_GATES.md](docs/PRODUCTION_RELEASE_GATES.md);
it records the exact candidate fingerprint, gates G0-G18, service decisions, evidence
boundaries and the current **NO-GO** decision. Functional reconciliation is in
[docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md](docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md). No deployment,
real worker data, real email/push, paid provider call, production database or external
account was used. Phase 7 below remains the last complete local implementation checkpoint.

## Production Hardening And Admission Verification Checkpoint

25 October 2026: production hardening added a separate, fail-closed production admission
review while the hosted staging path remains synthetic-only and the production tier remains
hard-blocked. No production listener, real data, external email/push, paid provider call,
hosted database or deployment was used.

- `server/postgres/production-admission.mjs` validates a production-only
  `production`/`live`/`credential`/`real` configuration: exact HTTPS origins, exact trusted
  proxies, certificate-verified PostgreSQL with a production schema/role profile, private
  storage, verified mail, webpush VAPID, explicit provider stages, disabled fallback and a
  candidate-bound `understood-production-approval-v1` manifest with G0-G18 evidence and
  seven approvals. `scripts/production-admission-check.mjs` reports blocker codes and exits
  1 without opening a listener, database connection or provider call.
- `LIVE_PROVIDER_ADAPTERS` is deliberately empty; synthetic, mock, fixture, local and
  free-tier names are rejected. API/worker admission cannot pass even with a complete
  fabricated manifest, and no production startup wiring exists. `server/auth.mjs` still
  rejects production and `hostedSyntheticConfig` still admits only explicit synthetic
  staging. `tests/production-admission.test.mjs` passes 6/6, including demo identities,
  synthetic evaluators, mocked speech, fixture mailboxes, wildcard proxies, unapproved
  free-tier dispatch and operator secret separation.
- A disposable local native PostgreSQL 16.15 cluster (loopback, temporary data directory,
  read-only existing runtime, no Docker restart or saved environment touched) passed:
  fresh-schema migration 1/1, concurrency 2/2, encrypted native `pg_dump`/`pg_restore` with
  isolated readback and quarantine 1/1, and local certificate verification with wrong-CA
  rejection (`DEPTH_ZERO_SELF_SIGNED_CERT`). Evidence:
  `artifacts/native-pg16-2026-10-25/`. This is not production-major/Neon, public-CA or
  native runtime-role evidence.
- The standard full suite was not clean: 1,489 tests / 1,484 passed / 0 failed / 4 skipped
  / 1 cancelled (3,423,492.6709 ms). The cancelled test
  `tests/restore-retention.test.mjs:297` hit the unchanged 300,000 ms per-test timeout under
  suite concurrency (301,299.4742 ms) with no failed assertion; the file passes 16/16 in
  isolation (348,809.8558 ms; affected test 78,180.1132 ms). Logs:
  `artifacts/production-admission-2026-10-25/`. The four skips are the native tests, which
  were executed separately. No clean-suite claim is made.
- `npm run typecheck` and `npm run build` exit 0 on this tree, with the pre-existing
  large-chunk and ineffective-dynamic-import warnings.

Decision remains **NO-GO**. External gates remain: production-major/Neon PostgreSQL with
native roles and proxy/TLS, approved real-data providers/privacy, verified email domain,
real push and physical-device acceptance, independent security and accessibility/AT review,
approved compute/DNS/public TLS, capacity/load, deployed monitoring/incident drill, off-site
backup/key custody/DR, frozen candidate and final written authorization. Details:
`docs/PRODUCTION_RELEASE_GATES.md`, `docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md`.

Docs updated: `docs/PRODUCTION_RELEASE_GATES.md` (G0, G3-G6 and G13 status plus suite
evidence), `docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md` (X1-X3 and evidence identity),
`docs/READINESS.md` (current checkpoint).

## Phase 7 Integration And Release Verification Checkpoint

25 October 2026: Phase 7 checked schema/permission parity, notification lifecycle around
import, deletion and restore quarantine, ran the complete repository suite against the final
source, and rechecked the built staff/worker interfaces at phone and desktop widths. No
deployment, external push, real worker data, paid provider call, production database, saved
demo database or pre-existing server was used. Production readiness is still not established.

Notification lifecycle and privacy:

- Worker deletion revokes push subscriptions (`worker_deleted`), cancels queued/sending push
  deliveries and revokes worker sessions on both SQLite and PostgreSQL. The SQLite cleanup was
  added for parity; both deletion tests pass. A deleted worker's registered device or queued
  alert therefore cannot survive the deletion request.
- Restore quarantine revokes push subscriptions (`restore_quarantine`) and cancels
  queued/sending deliveries inside the audited quarantine operation while retaining
  publication, relational and audit evidence. The quarantine test asserts this and passes.
- Synthetic SQLite-to-PostgreSQL cutover preserves notification events and read receipts as
  immutable in-app history, but recognizes push subscriptions and deliveries only to omit
  them. A migrated copy cannot revive a device binding or dispatch a queued local push. The
  new retention test passes.
- Delivery fanout rechecks recipient session validity and active principal state at send time
  in both repositories; an unavailable recipient becomes `expired`/`recipient_unavailable`
  and the subscription is revoked instead of delivering. This is source inspection, not
  external-device evidence.
- Runtime permission profiles include the notification/read/subscription/delivery tables, and
  the operator policy intentionally grants no access. Migration 108 is additive; no
  destructive down migration is provided, so rolling back application code leaves the tables
  and immutable evidence in place.

Verification and fixes:

- Final `npm test` on the integration-complete source: 1,483 tests, 1,479 passed, 0 failed,
  4 skipped, 2,737,801.731 ms (45m 37.8s). Evidence:
  `artifacts/phase7/full-suite-2026-10-25-summary.log` (final 80-line summary excerpt; the run
  was not tee'd to a full log). The four skips are one native latest-schema migration test,
  two native concurrency tests and the native backup/restore test. No
  `UNDERSTOOD_PG_TEST_URL` or running PostgreSQL target was available; a disposable Docker
  PostgreSQL start was attempted but the container never left `Created`, so no native
  concurrency, role or TLS claim is made. PGlite remains non-native evidence only.
- `npm run typecheck` exits 0 and `npm run build` exits 0 with the pre-existing large-chunk and
  ineffective-dynamic-import warnings. The new source and test changes are included in the
  suite; the documentation updates affect no runtime.
- Built-browser checks used disposable fixtures with synthetic data only (worker port 3225,
  staff port 3212) served from built assets. Worker Arabic RTL at an exact CDP 320px viewport
  had `innerWidth=320`, `scrollWidth=320`, no horizontal overflow and 7 to-do items. Worker
  English and staff English were checked at 1440px. The Arabic worker detail opened after a
  keyboard Enter on "استمع وأجب". Staff notifications showed 26 unread at both 1440px and
  320px. Focus outlines measured 3px solid, Enter activation worked and reduced-motion
  emulation was applied. Evidence: `artifacts/phase7/worker-ar-320.png`,
  `worker-en-1440.png`, `worker-ar-detail-320.png`, `staff-notifications-1440.png` and
  `staff-notifications-320-fixed.png`.
- The staff site switcher clipped the organization to "C..." at 320px. It now hides the
  organization/separator below 480px and wraps the site name on two lines while keeping both
  names in the accessible label; the post-fix 320px capture shows "Beirut site" with zero
  document overflow. The 1440px staff capture predates this <=480px-only change, and the
  desktop breakpoint is unaffected.

Known limits:

- Native PostgreSQL concurrency/TLS/role and native backup/restore tests remain unexecuted
  (4 skips). Hosted concurrency, monitoring and a production backup rehearsal remain open.
- No real web push was sent and no physical-device notification, notification click or
  endpoint refusal/reassignment was observed. The synthetic adapter and service-worker shell
  show service wiring, not visible device acceptance.
- Worker 15-locale dictionaries and staff EN/AR/UR controls were exercised in earlier
  checkpoints; this phase browser-drove worker Arabic/English and staff English. Staff Arabic
  was not re-driven, and no physical-device/AT, real microphone/audio or hardware pass is
  claimed.
- Production tier remains fail-closed. Real worker data, invitations, email, paid AI,
  external push, production data and deployment were not used. Provider/privacy/security
  review, physical-device acceptance and deployment authorization remain external gates.

Docs updated: `docs/NOTIFICATIONS.md` (Phase 7 lifecycle), `docs/POSTGRES_CUTOVER.md`
(notification events preserved, push bindings/deliveries omitted), `docs/POSTGRES_BACKUP.md`
(quarantine cancels push) and `docs/READINESS.md` (historical counts labelled, current
pointer).

Next task: run the native PostgreSQL concurrency/TLS suite and real push/device acceptance in
an authorized environment, then an independent accessibility/security pass. Keep production
fail-closed and do not deploy until those gates and explicit deployment approval are complete.

## Phase 6 Notifications And Web Push Checkpoint

25 October 2026: Phase 6 added a durable, server-backed notification spine and optional web
push without changing the record of delivery already shown elsewhere. PostgreSQL migration
`108_notification_events.sql` and the matching SQLite guards create immutable
`notification_events` and `notification_event_reads` rows. Events are unique per
organization/site/audience/recipient/dedupe key, scoped by trigger to a real site and to a
same-site worker or owner/supervisor, and read receipts can only be inserted once for the
event owner. Worker event kinds are `instruction.available`, `clarification.followup`,
`repeat.available`, `language.decided` and `deadline.reminder`; supervisor push kinds cover
help requests, clarification assignment/routing/escalation/messages, worker language
requests, answers needing attention, incomplete instruction sends and overdue assignments.
Events and push subscriptions are never physically deleted by the product; revocation is
recorded in place.

Workers now have a `#notifications` inbox in all 15 worker UI locales. It pages 10 items at a
time, has All/Unread filters with a server unread count, marks read through a POST receipt,
opens an assignment or the Help destination, and keeps the in-app record usable when push is
disabled, synthetic or denied. The header bell appears without an invented badge, and the
notifications view does not run the ordinary polling loop. Lock-screen copy is generic in
every worker language and never carries names, answer text, rubric content, audio links or
worker identifiers. The push service worker shows a generic fallback for malformed payloads,
always opens `/#notifications` with no bearer token in the URL, and lets the normal session
check decide whether the person must sign in again.

Push is optional and environment-separated. The server supports `disabled`, `synthetic` and
`webpush` adapters; synthetic mode requires the synthetic data class and is visibly labelled
as delivering no external alerts. VAPID private material stays server-side. Public keys only
reach the browser. A subscription is bound to organization, site, principal, session and
endpoint hash; endpoints must be HTTPS on an allowlisted push service with no credentials or
fragment; each principal may keep 10 active subscriptions. Reusing an endpoint under another
principal revokes the prior binding, signing out revokes that session's registrations, and a
disabled or deleted principal stops receiving attempts. Delivery attempts use a queued
outbox with bounded retry/backoff (five attempts), explicit `accepted`, `uncertain`, `failed`,
`cancelled` and `expired` states, stale-send recovery, endpoint expiry cleanup, recipient
access rechecks before fanout, and no claim that acceptance equals sight. Real external
delivery was not exercised.

Verification: the focused notification/push/public-shell/primary-layout set passed 48/48 in
about 28.3 seconds across eight files. The run exposed a timestamp-tie flake in the
`notification-events` test: two events recorded in the same millisecond were ordered by random
UUID after `created_at`, not by insertion order. The test now records them 30 seconds apart, so
the checked order is deterministic; the production query's `created_at DESC,id DESC` ordering
is unchanged and stable for a fixed dataset. `npm run typecheck` passes and `npm run build`
passes with the pre-existing chunk-size and ineffective-dynamic-import warnings.

Browser evidence used a disposable SQLite database on separate API/web ports 3290/3291 with
the synthetic push adapter; the saved demo database and pre-existing servers were untouched.
Worker 014 rendered 13 events over two pages in Arabic RTL, English and Urdu LTR/RTL with
localized labels and dates, persisted a mark-read receipt, removed the item from Unread,
navigated Open to `#inbox`, and showed the empty-unread state in English and Urdu. No repeated
notification GETs appeared while the view stayed open. Supervisor Maya's page loaded with zero
site notifications, the synthetic adapter notice, the blocked-browser-permission notice and
the in-app fallback text. A synthetic-only fake subscription inserted for that signed-in
session appeared as "Device registration 1"; Remove removed it and the database row recorded
`revoke_reason='user_revoked'`. On a local production preview (port 3292), `/sw.js` was served,
the service worker activated at scope `/`, the shell cache was created, the page became
controlled and the push listener was present; the registration and cache were removed after
the check. The worker header wrap breakpoint was widened from 480px to 640px after the new
bell overlapped the brand at about 510px; the corrected Arabic header was rechecked.

Known limits at this checkpoint: no external push was delivered, and the browser used a
synthetic adapter where the enable button is intentionally unavailable. The staff enable
button itself was therefore not browser-driven; its subscription validation and HTTP flows
are covered by tests. The full empty-all notification state was not visually verified because
read receipts are immutable; the verified empty-unread state uses the same render branch. The
notifications-specific load-failure view was not browser-verified because stopping the
disposable API triggered the global session lock before that view could render. Service-worker
push notification display, notification click and real endpoint refusal/reassignment by a
push service were not driven in a browser. This checkpoint is not a release or
production-readiness certificate.

Next task: Phase 7 release verification.

## Phase 5d Verified Owner Registration And First-Run Checkpoint

24 October 2026: verified owner registration is now the only public path that creates an
organization, and the 14x24h / 25-worker trial starts only when email control is verified.
`POST /api/registration` collects owner name, work email, password, company name, operating
country, required terms and privacy acknowledgement and an optional business phone; it never asks
for a card, provider keys, worker uploads or site hierarchy, and offers no public role choice. The
public response is the same generic acceptance for unknown, existing-staff and duplicate emails,
and duplicate or concurrent requests create no second workspace and no mail. Registration records
store only an email hash plus an AES-256-GCM sealed envelope for the encrypted owner PII and
password hash; raw verification secrets are never stored. PostgreSQL migration
`106_owner_registration.sql` and the idempotent SQLite schema add `organization_registrations`,
`registration_mail` and `registration_tokens` with immutability triggers for registration identity,
payload and verified rows, delivery attempts capped at three, and tokens that are one-use, hashed,
24-hour-lived and revoked when a resend rotates them. Registrations expire after seven days, each
request may resend at most five times, per-email and per-IP budgets bound resend abuse, and the
shared outbox capacity is enforced before a registration commits. Verification succeeds only for a
pending, unexpired registration with a matching unused token; completion writes the email hash,
organization, first site (company name, UTC pending onboarding), owner staff row and credentials,
organization settings, entitlement, entitlement transition and audit in one transaction, then
marks the token used. A replay or lost-response retry returns the same outcome without creating a
second organization, sending a session or moving the trial.

The entitlement inserted at verification is exactly 14*24 hours from server time with a company-wide
active-worker limit of 25 and no payment state. Refreshing, resending, changing email, re-opening a
completed registration or starting a fresh registration after expiry never restarts or extends that
clock. The worker cap counts active and setup-pending identities across every site; the 26th add is
rejected atomically without partially importing a batch. There is no fixed instruction count.

PostgreSQL migration `107_first_run_onboarding.sql` adds `staff_interface_language` and
`first_run_completed_at` to `site_settings` and backfills existing sites as already configured.
After verification, the owner lands in a short first-run flow that asks for the first site name, a
confirmed timezone and the default staff interface language, then shows Add your team, Create your
first instruction and Go to Today. Completing it updates the existing site and site settings with a
revision and audit entry; duplicate submissions return the same saved values, a forged site is
rejected, and legacy sites without a settings row are reported complete and cannot be modified
through this endpoint.

Self-review during browser verification fixed three presentation defects: the registration form
claimed email delivery was unavailable even when it was configured (replaced with a truthful
one-use-link note), the incomplete first-run form displayed "Setup is already complete" in
contradiction with itself (removed from the incomplete state), and saving first-run navigated away
before the designed ready panel could appear (now stays and shows the ready panel immediately).

Verification: focused Phase 5d/entitlement/first-run suite (`registration`,
`postgres-registration`, `entitlement`, `entitlement-activation`, `first-run`) passed 32/32 in about
49.6 seconds before the three UI copy fixes; `first-run` alone passed 4/4. After those fixes,
`npm run typecheck` and `npm run build` pass. Browser evidence used a disposable SQLite database,
separate API/web ports 3244/3245 and a synthetic capture mailer: registration accepted with a
generic response, the captured one-use link verified to "Email verified" without signing the owner
in, sign-in redirected to first-run, Arabic setup saved site name/timezone/language with
`site_settings.revision=1` and an `onboarding.first_run_completed` audit, and the ready panel
appeared with all three next actions, with Add your team navigating to `#people/new`. The
disposable database showed the entitlement start and end exactly 336 hours apart, a worker limit of
25, plan `trial`, and an `organization.registered` audit. No deployment, real invitation/email/push,
paid provider call or real worker data was used; the saved demo database and pre-existing servers
were untouched.

The full suite was rerun after the Phase 5d changes: 1457 tests, 1451 passed, 2 failed and 4 skipped.
Both failures were test-side time dependence, not product regressions, and both were fixed. The
provider-verification quota test inserted its synthetic operation with session-local `CURRENT_DATE`,
which the deliberately strict reservation guard rejects when it differs from the UTC quota day; the
test now uses the same UTC day as the guard. The SQLite report-publication paging test seeded a
publication dated "now", which entered its fixed 2026-10-25 Asia/Beirut window once the run crossed
local midnight; the assertion now constrains the search term as well as the civil-date range. Both
files pass 32/32 after the fixes. Integrating Phase 5d also required importer support for the three
entitlement tables and the two new `site_settings` columns (with pre-onboarding defaults), legacy
backup compatibility and updated writable-table counts (application 133, worker 104). Those affected
suites pass. The corrected full-suite pass count is therefore 1453 of 1457 with the same 4 skipped;
the full suite has not been rerun a second time since these two test-only fixes.

Next task: Phase 6 notifications and shared-device work, then Phase 7 release verification.

## Phase 5a-5c Entitlement, Trial Limits And Activation Checkpoint

24 October 2026: organizations now have a server-enforced entitlement separate from payment
collection. PostgreSQL migration `105_organization_entitlements.sql` and the idempotent SQLite
schema create `organization_entitlements`, immutable `organization_entitlement_transitions` and
`organization_activation_requests`, with triggers enforcing revision increments, transition scope,
one pending request per organization and closed-request immutability. A missing entitlement row is
reported honestly as legacy/unmanaged and remains writable; `trial`, `active` and `read_only` use
server time, and a trial past its exact `ends_at` is effectively read-only even before an operator
writes the state. Read-only blocks new instruction sends, answers/recordings, acknowledgments,
repeats, conversation/help writes, manual or scheduled publish release, worker creation/import or
reactivation and new billable presentation generation. Reads, login/logout, credential recovery,
security revocation, privacy/retention, settlement/reconciliation, exact duplicate replays and
activation requests remain available. The 25-active-worker trial cap applies company-wide across
sites, not per site, and reads the entitlement limit rather than the illustrative briefing counts.

Company owners and administrators see plan state, access state, days remaining, end date,
active-worker usage against the limit, terms reference and revision on Plan & usage. They can submit
a durable, scoped activation request with an optional note; the request is recorded for platform
operations, never changes access or payment by itself, and survives reload while a saved intent is
recovered only after an exact acknowledgement and receipt match. Only an authorized platform
operator can write the revision-bound entitlement command, record plan/terms/reason, accept the
pending request (auto-accepting the latest pending request for any non-read-only state) or decline
it; both SQLite and PostgreSQL store immutable audit/transition evidence and replay-safe receipts.
The operator console now has an Entitlements tab with strict local validation of the same command
shapes. No prices, invoices or payment state are invented, and no activation occurred outside the
disposable synthetic test stack.

Self-review fixed a real client-contract defect found during browser verification: a pending
activation request keeps the entitlement revision captured when it was submitted, so a later
operator revision advance made `checkedEntitlement` reject the whole Plan & usage payload. The
validator now accepts an older capture revision (rejecting only a revision newer than the current
one) and a regression test covers the stale-pending case.

Verification: focused Phase 5 suite 16/16 passed in 25.4 seconds (`entitlement`,
`entitlement-activation`, `activation-request-recovery`, `usage-state`), covering exact expiry,
unmanaged legacy access, worker-capacity rejection, read-only write surfaces with duplicate receipt
replay, both backends' operator commands and activation requests, HTTP session-context binding and
the new client regression. `npm run typecheck` and `npm run build` pass. Browser evidence on a
disposable SQLite stack (separate ports 3099/5180, synthetic data only): an owner request recorded
`POST /api/entitlement/requests` 201, fetched its receipt 200 and cleared the saved intent; the
pending request survived reload; after setting the trial end in the past, the page showed
"Trial Ended · Read-Only", 0 days and the read-only notice; `POST /api/instructions/send` returned
403 `Workspace is read-only` while a new activation request reached 409
`Activation request already pending` (not the read-only gate); after declining that request in the
disposable database, the read-only page rendered "Request activation" and a submitted request was
recorded and displayed. The operator console's Entitlements tab is PostgreSQL-only and was not
browser-driven in this checkpoint; its command/HTTP flow is covered by the PostgreSQL tests above.
The full suite has not been rerun since these changes and will be required before any release claim.
No deployment, real invitation/email/push, paid provider call or real worker data was used.

Next task: Phase 5d verified owner registration and the 14x24h/25-worker trial, then Phase 6
notifications/shared-device work and Phase 7 release verification.

## Phase 4 Automatic Send And Mode-Aware Reporting Checkpoint

24 October 2026: automatic Send now runs as one durable, immutable-captured operation instead
of a browser-driven publish chain. `instruction_sends`, `instruction_deliveries` and
`instruction_retries` force a `preparing` delivery row per captured recipient at request time
and keep the request JSON, audience, language, response mode, delivery mode and crew provenance
immutable. Preparation, authority, worker state, language, deletion, deadline and content
readiness are rechecked on both SQLite and PostgreSQL before anything is released; a publication
is created once per request and late delivery adds assignments to that same publication/version.
A recipient is released only when that recipient's selected artifacts are ready: acknowledge mode
uses confirmation-only assignment content, voice mode requires usable audio, text mode requires
text, and both mode requires both. Common-source failure blocks the whole Send; a target-language
failure makes only that language undelivered. Delivery states are `preparing`, `available`,
`blocked`, `failed` and `withdrawn`; persisted counts report truthfully (for example
"Sent to 18 of 25; 7 not delivered") and retry only reopens eligible unfinished recipients with an
immutable retry receipt. Background completion and reconciliation finish the request without a
browser-held chain, rechecking the deadline and recipient state at release time.

Reports and CSV exports are now mode-aware through the shared `reportActivity`/`selectReport`
builders. They distinguish captured audience, preparing/not delivered, available/delivered,
answered, acknowledged, matched, follow-up needed, pending check and human-resolved outcomes, and
show their denominators. Unreleased recipients are never counted as failing to respond; missing
historical mode fields are marked as legacy/unknown rather than invented. The export accepts the
original 6/8-cell rows, the Phase 4 8-cell mode-aware rows and an optional 9th follow-up-status
cell, so earlier artifacts still parse. Self-review fixed a case-repeat interaction with the
assignment deadline, corrected generated-audio DTO exposure so only generated speech URLs are
returned, and made the retention upgrade statement tolerate pre-migration schemas. PostgreSQL
migrations through `104_instruction_content_retention.sql` are applied by the migration runner;
migration 105 was not started in this checkpoint.

Verification: the full suite ran 1,415 tests with 1,408 passing and 4 environment-gated skips; the only three
failures were outdated hardcoded migration counts (102 instead of 104) in
`language-registry.test.mjs`, `neon-rehearsal.test.mjs` and `operator-permissions.test.mjs`. After
correcting those expectations, the three affected files passed 22/22 (exit 0, ~79 seconds).
Targeted Phase 4 PostgreSQL/SQLite delivery, retry and report tests passed before that run, and
`npm run typecheck` passed. All data was synthetic, no live AI/provider was called, no deployment
was changed and no real worker data was used.

Open items: newly released late recipients do not yet receive an in-app notification or web push
(Phase 6); instruction Send does not yet enforce entitlement/quota gating (Phase 5); browser
export evidence predates the optional 9th export column; reports still show the original
publication language and do not expose a later presentation language under a clear label;
native-speaker review remains pending. This checkpoint is not a production-readiness certificate.

Next task: Phase 5a entitlement core and read-only gates, followed by the 25-worker trial cap,
usage/operator activation surfaces and verified owner registration.

## Phase 3d Historical Translated Presentation Checkpoint

24 October 2026: added an additive translated-presentation layer without changing the
original record. PostgreSQL migrations `100_presentation_artifacts.sql`,
`101_presentation_retention.sql` and `102_recording_presentation_guard.sql`, plus the
idempotent SQLite schema in `server/presentation-schema.mjs`, create
`presentation_artifacts` and `answer_presentation_bindings`. Each artifact is keyed by
assignment, source kind (`instruction` or `answer`), source ID and target language and
stores the original language, publication ID/version, source hash, provider/live flags,
status and translated content. Typed answers bind the presentation and presented
question at acceptance; recordings gained optional `presentation_id`,
`presentation_language` and `presented_question` columns. Assignments, attempts,
publications, publication snapshots and recording bytes are never rewritten by
presentation reads or generation, and the tables do not participate in assignment,
answer or delivery denominators.

`GET /api/worker/briefings/:assignmentId/presentations` reads cached artifacts only and
never generates. `POST` on the same path accepts the exact request shape
(`requestId`, `sourceKind`, optional `sourceId`), replays the same request and creates
at most one artifact per assignment/source/target. Instruction presentations can be
served directly from an existing approved language snapshot in the publication
(`publication-snapshot-v1`, `live=false`); translation remains capability-bound to
English, Arabic and Urdu. A UI-only target returns
`unavailable/language_capability_unavailable`, a missing translator returns
`unavailable/translation_not_enabled`, a paused tenant returns
`deferred/generation_paused`, a provider failure stays `failed`, the same language
returns `not_required`, and expired briefing content returns
`unavailable/content_expired`. Pending work holds a bounded lease. Because the target
is always the worker's currently approved language, changing that language creates a
new artifact for the new target while earlier artifacts and bindings remain intact;
binding an old artifact after the preference changes is rejected. The worker UI shows
the translated view for instruction and answer history in all 15 UI locales, labels it
as a translated view whose original remains the record, and never presents generated
text or audio as the worker's original recording; original audio playback stays
attached to the original recording.

Deletion and retention now cover the derived copies. Worker deletion redacts ready
presentation content and presented questions, fails pending artifacts and requires
those tombstones before completion. Answer-text retention redacts ready answer
presentations, and briefing-content retention redacts instruction and answer
presentations, bindings and recording provenance. While hardening the recording
provenance guard, self-review found a SQL three-valued-logic hole: the original guard
used `OLD.presented_question NOT IN ('[Deleted]','[Expired]')`, which evaluates to NULL
when the old value is NULL, so an update from NULL to arbitrary text was accepted.
Migration 102 and the SQLite trigger now require an existing non-null, non-sentinel
value before permitting the one-way tombstone. The PostgreSQL retention code also
guards its presentation statements when upgrading from a pre-100 schema so the
old-schema expiry-origin test still proves erased sources are not reconstructed.

Verification: the complete suite passed 1,394 of 1,398 tests with 0 failures and 4
environment-gated skips (native `pg_dump`/`pg_restore`, and three real-PostgreSQL
concurrency/migration tests) in 32 minutes 15 seconds. The presentation contract
tests passed 3/3 across SQLite and PostgreSQL, the client presentation contract and
copy tests passed 11/11, the migration/upgrade batch passed 11/11, and the Neon
rehearsal plus operator-permission batch passed 18/18. `npm run typecheck` passed, and
the production build passed with only the known chunk-size and
`INEFFECTIVE_DYNAMIC_IMPORT` warnings.

Open items: read-only entitlement gating for cached presentation reads is not built;
reports and exports still show the original publication language and do not yet expose
a later approved presentation language under a clear label; audio-only answers have no
translated text view because the answer source requires accepted typed text, though
the original recording remains available; privacy-ledger format v8 restore
reconciliation does not yet include presentation artifacts, bindings or recording
provenance even though backups inventory all tables and runtime redaction covers them;
native-speaker review of the UI translations is still pending; and the translated
panel was validated by component/server tests rather than a browser walkthrough
because the browser viewport was unavailable. All data was synthetic, no provider was
called, nothing was deployed, and no real worker data or paid service was involved.
This checkpoint is not a production-readiness certificate.

Next task: begin Phase 4 automatic Send by auditing the existing publication,
assignment and recipient-release path, then adding a durable captured Send operation
with safe per-recipient release and truthful partial-delivery status. No paid provider,
real invitation or public deployment is part of that work.

## Phase 3c Worker UI Localization And Honest Readiness Checkpoint

24 October 2026: the worker experience is presented in all 15 selectable locale codes
covering the 14 required worker languages, with Punjabi split into Gurmukhi
(`pa-Guru`) and Shahmukhi (`pa-Arab`). Navigation, paging, access entry, first-use
setup and recovery, inbox, assignment detail, listen/read, typed and recorded drafts,
offline copy, device controls, help and history, sent answers, receipt, conversation,
language settings, shared-device cleanup and recording notices now resolve their copy
from locale dictionaries keyed by `WorkerUiLanguage`; a missing locale or key fails
typecheck and the dictionary tests. Direction comes from the shared registry (RTL:
Arabic, Urdu and Shahmukhi Punjabi; LTR: the other twelve locales). Instruction,
question and answer content keeps its own `lang`/`dir`, so a Hindi LTR shell can show
Arabic RTL content without inheriting the shell direction.

The interface language is stored only for the exact unexpired worker session context.
It grants no session authority, survives a reload but not a session change, and
shared-device cleanup removes it. First use requires the supervisor-set language;
later changes stay pending requests until staff approval. Viewing a page never
rewrites the stored worker language or the original assignment language.

`GET /api/language-readiness` now reports all 15 locales instead of three. Every row
reports worker UI as `ready` with explicit evidence that native-speaker review is
still pending. Stored content remains `ready` or `missing` based on the latest scoped
publication. Translation is `not_tested` only for English, Arabic and Urdu under the
synthetic environment/declared adapter and `unavailable` for the other twelve;
speech is `not_tested` only for English and Arabic and `unavailable` everywhere else,
including Urdu, which the configured adapter does not support. Generation defaults
remain restricted to content-capable languages, `realDataAllowed` stays `false`, and
no UI-only locale gains a translation or speech claim. Publication still fails closed
when a recipient language has no content support; no translated instruction is
invented, and truthful partial delivery remains open.

Verification: the strict production build (`tsc --noEmit` plus Vite) passed after the
readiness copy update with only the known chunk-size and INEFFECTIVE_DYNAMIC_IMPORT
warnings. The full suite was split into three sorted batches: batch 1 passed 448/448;
batch 2 reported 510 pass, 4 native PostgreSQL skips, 0 assertion failures and one
300-second timeout under parallel load; batch 3 passed 419/419. The timed-out test
(`tests/postgres-backup.test.mjs`, isolated physical embedded restore) passed 8/8 in
43.1 seconds when rerun alone, confirming resource contention rather than a product
failure. Across the three batches that is 1,382 tests, 0 assertion failures and 4
environment skips, or 1,378 passing and 4 skipped after the isolated rerun.

Browser verification used a freshly seeded disposable synthetic SQLite database, a
disposable API on 3040 and the production bundle served on 3042; the saved demo
database was not modified. Worker 029 (`pa-Arab`) rendered a Shahmukhi RTL shell
(`dir=rtl`, `lang=pa-Arab`) around Urdu (`lang=ur`) content; Worker 014 (`hi`)
rendered a Hindi LTR shell (`dir=ltr`, `lang=hi`) around Arabic (`lang=ar`) content
on the assignment detail, with the original English answer untouched. Evidence:
`artifacts/phase3c-locale-browser-2026-10-24/worker-pa-arab-inbox-2026-10-24.png`,
`worker-hi-inbox-2026-10-24.png` and `worker-hi-assignment-2026-10-24.png`. The
fixture servers were stopped and the scratch database and scripts deleted.

Native-speaker review of the twelve new UI translations is still pending. Historical
translated presentation, partial delivery with a truthful undelivered count,
automatic Send, trial/entitlement/read-only behavior, web push and shared-device
handoff, and release verification remain open. All data was synthetic; nothing was
deployed, and no real worker data, paid provider call, invitation or push message was
involved. This checkpoint is not a production-readiness certificate.

## Phase 3c Worker Locale Registry And Storage Checkpoint

23 October 2026: added the shared locale and capability foundation for the 14 required
worker languages. `server/languages.mjs` (with TypeScript declarations consumed by both
the server and the React client) is now the single registry for 15 selectable locales:
English, Arabic, Hindi, Urdu, Bengali, Malayalam, Tamil, Telugu, Nepali, Filipino,
Sinhala, Russian, Punjabi Gurmukhi, Punjabi Shahmukhi and Indonesian. Bare `pa` is
rejected; the two Punjabi scripts are explicit locales with their own direction
(Gurmukhi LTR, Shahmukhi RTL), and Arabic, Urdu and Shahmukhi are the RTL set.
Capabilities are declared per stage rather than implied by dropdown membership: UI text
is implemented for all 15; translation, instruction/question content and assessment
remain en/ar/ur; transcription and speech remain en/ar; staff source input remains
en/ar. Provider adapters and verification descriptors still declare exactly those
content/speech limits, so no new-language audio or translation is claimed.

Storage now accepts every registered locale. SQLite adds any missing Phase 3a identity
columns before transactionally rebuilding `workers`, `assignments` and
`worker_language_requests` with the expanded CHECK lists, preserves rows and foreign
keys, runs `PRAGMA foreign_key_check` and recreates the indexes and guards on startup.
PostgreSQL migration `099_worker_language_locales.sql` replaces the twelve pure language
CHECK constraints; content-generation JSON checks intentionally stay limited to
content-capable languages. The worker directory filter and direct staff correction,
worker session validation, crew DTOs, response filters, report breakdowns and language
labels are registry-backed. The Team worker form and directory filter now list all 15
locales with self-names. `settings-input.mjs` still rejects generating a language without
translation content, so a worker who selects a UI-only locale cannot yet receive an
instruction: publication fails closed with `Recipient language is unavailable` until
provider content exists and the planned partial-delivery flow can report undelivered
workers truthfully. That is an open requirement, not a completed capability.

Verification: `tests/language-registry.test.mjs` 4/4 pass (registry invariants and
capability honesty; in-place SQLite upgrade preserving names, a pending request,
foreign keys, triggers and indexes while accepting `pa-Guru`/`pa-Arab` and rejecting
bare `pa`; a legacy worker table without Phase 3a columns; PGlite applying all 99
migrations and storing all 15 locales). Focused regression batches passed 60/60
(directory, settings, reports, responses, assignment languages, embedded PostgreSQL,
Neon rehearsal, operator permissions and upgrade guards), 40/40 (worker directory and
language HTTP, imports, worker UI/session locale) and 71/71 (reports, worker
credentials, draft languages, language artifacts, audit/expiry upgrades and
verification authority). `npm run build` passes with only the known chunk-size and
INEFFECTIVE_DYNAMIC_IMPORT warnings. All data was synthetic; nothing was deployed, and
no real worker data, provider call, invitation or push message was involved. Worker
interface translation for the 12 new locales, first-use locale selection UI, historical
translated presentation and partial delivery remain open. This checkpoint is not a
production-readiness certificate.

## Phase 3b Worker ID And Password Checkpoint

23 October 2026: implemented the worker credential identity with synthetic data only.
Workers sign in with company ID, worker ID and password; first use is a staff-issued
one-time setup code (43-character base64url, SHA-256 at rest, 5-1440 minute expiry).
Worker IDs are trimmed, NFKC-normalized and uppercased, and a credential's login must
match its worker's code. Passwords use scrypt (N=16384, r=8, p=1), 8-128 characters,
no edge whitespace and cannot equal the login or company ID. Issuing a setup code or
resetting a password revokes all prior worker sessions, setup codes and access links
and increments `credential_revision`; new sessions bind to that revision, so a reset
invalidates a live session immediately. Disabled workers and paused or archived sites
fail closed. Failed password and setup attempts share the existing hashed 15-minute
global/per-account/per-IP budget, with a worker-specific limit of eight. Staff owners
and supervisors see sign-in status in Team, issue or reset a code with a confirmation
and expiry choice, and can copy a one-time handout; the worker entry now offers Worker
ID and password, first-time setup and access-link modes, clears stale failures when the
method changes and warns when signing in will end an active staff session. Handout copy
failure falls back to a selectable sign-in sheet.

SQLite (`server/worker-credentials.mjs`) and PostgreSQL
(`server/postgres/worker-credentials.mjs`, migration
`098_worker_password_credentials.sql`) implement the same contract. PostgreSQL session,
import, runtime-permission, backup, restore-replay and retention surfaces account for
the two new tables and the revision-bound session identity. Focused verification:
SQLite `tests/worker-credentials.test.mjs` 6/6 pass; PostgreSQL
`tests/postgres-worker-credentials.test.mjs` 5/5 pass; PostgreSQL auth 6/6, import
11/11, embedded migration 1/1, runtime 4/4, backup 8/8, restore retention 16/16 and
activity retention 5/5 pass after the migration-list update. `npm run build` (strict
TypeScript and Vite) passes with only the known chunk-size and
INEFFECTIVE_DYNAMIC_IMPORT warnings.

Browser verification used a disposable PGlite fixture at `127.0.0.1:3245` and the
production build. Staff issued a setup code; a worker completed first-time setup using
mixed-case `WorkEr 001` and reached the inbox at credential revision 2; a wrong password
was rejected; staff reset the password and the live worker session was revoked at once
(`sessions=0`, state `setup`, revision 3); the old password failed and a second setup
activated revision 4; the existing one-time access-link flow still signed in. Evidence:
`artifacts/worker-credentials-staff-panel-full-2026-10-23.png`,
`artifacts/worker-credentials-issued-dialog-2026-10-23.png`,
`artifacts/worker-credential-entry-login-full-2026-10-23.png`,
`artifacts/worker-credential-login-failed-2026-10-23.png` and
`artifacts/worker-credential-inbox-2026-10-23.png`. The local demo runs in access mode
`demo`, so its Team view hides credential controls by design; browser credential
evidence came from the credential-mode PostgreSQL fixture, while SQLite credential mode
is covered by its focused tests, not a separate browser run.

Full-suite verification, 23 October 2026:
`node --test --test-timeout=300000 tests/*.test.mjs` exited 0 with 1376 tests,
1372 pass, 0 fail, 4 skipped, 0 cancelled and 0 todo in 1,719,631 ms
(`artifacts/full-suite-2026-10-23-clean2.log`). The four skips are the known
external gates: native `pg_dump`/`pg_restore` without explicitly isolated
source/empty-target databases, and three real-PostgreSQL admission,
concurrency and migration tests without an authorized test server. The strict
TypeScript check and Vite build pass with only the known chunk-size and
INEFFECTIVE_DYNAMIC_IMPORT warnings. This run covers the Phase 3a/3b contract
updates (98 migrations, 13 hidden worker tables, 125 writable application
tables, the 14-key crew DTO validator, the duplicate worker-ID message and the
scheduler failure-injection prefix) plus load-tolerant deadlines for the Neon
interruption, provider-verification and restore-retention tests. The 14 worker
locales, automatic capture/orchestration,
trial entitlements, scoped push, physical-device/AT testing, real provider and database
integration, TLS/hosting and release gates remain open. Nothing was deployed here; no
real worker data, invitations, push messages, paid providers or production changes were
involved. This checkpoint is not a production-readiness certificate.

## Phase 3a Worker Identity And Language Checkpoint

23 October 2026: implemented the third phase's worker identity and persisted-language
foundation with synthetic data only. Workers now have an optional display name, and a
worker created without a language chooses it on first sign-in instead of inheriting a
browser preference. The server persists the language, selection time and source
(`worker`, `staff` or `migration`); a database trigger refuses to reopen selection.
Language changes use a scoped request ledger: a worker request stays pending until a
supervisor approves or rejects it with an expected-language check, a note and an
immutable decision, and a direct supervisor correction supersedes a pending request.
Unselected workers are excluded from instruction audiences so a send cannot silently
assign a language nobody chose. The page-session context now includes language and
selection state, so stale worker POSTs and staff directory reads are fenced when either
changes. Team exposes the name field, a choose-later option, a Not Selected badge, the
pending request and a decision panel; the worker shell exposes the first-use gate and a
localized change-request dialog. Legacy synthetic rows remain explicitly marked as
selected, and existing history is preserved. SQLite and PostgreSQL implement the same
domain contract (PostgreSQL migration `097_worker_language_identity.sql`);
the default runtime remains SQLite and the PostgreSQL path is exercised only in
isolated embedded tests.

Verification: focused worker-language suites rerun 9/9 pass (SQLite identity/search,
first-use persistence, request transitions, audience exclusion and context fencing;
PostgreSQL identity, immutable decisions and HTTP routes); the PostgreSQL domain suite
previously passed 45/45; `npm run typecheck` passes. The in-app browser at 634x473
verified the lifecycle against synthetic fixtures: a new worker `W-3101` named
"Synthetic Worker 31" was added with choose-later and appeared as Not Selected; its
first sign-in rendered the language gate, choosing Arabic persisted `language='ar'`
with `language_selected_by='worker'` and opened the inbox; the worker then requested
Urdu with a reason; owner Maya saw the pending change in Team, approved it with a note,
and the directory updated to Urdu, "Set by supervisor", with the request panel empty.
The approved synthetic request `d15d9961-3644-41df-bb56-d6b21e088c50` (ar → ur) is
retained in the local synthetic database. The temporary local test session was revoked,
existing worker-14 stayed unchanged, and the trigger prevented a forced reset to
first-use. No real worker data, provider call, invitation, push message or deployment
was involved.

A clean full-suite rerun after the Phase 2 and 3a changes is still required before
claiming a current total; the earlier focused PostgreSQL domain evidence does not
replace it. Phase 3b worker ID/password identity is now recorded in the checkpoint
above; the 14 worker locales, automatic capture/orchestration, trial entitlements,
scoped push and physical-device/AT testing remain open. This checkpoint is not a
production-readiness certificate.

## Phase 2 Simplification Checkpoint

23 October 2026: implemented the second phase of the complete implementation prompt with
synthetic data only. Supervisor navigation is now Today, Instructions and Team with
Reports and Settings secondary. The instruction composer is one page: record, type or
upload an English/Arabic source, choose recipients, leave **Include a question** on by
default, choose Text only, Voice only or Both (Both by default), and Send. Send options
are frozen per instruction in `instruction_sends`; snapshots carry `responseMode` and
`deliveryMode`, and a question-off instruction requires an explicit, immutable
acknowledgment instead of an assessed answer. Ready language versions are delivered to
their own workers and the send record reports delivered and undelivered counts
truthfully instead of claiming a complete send.

The worker experience now has To do and Done tabs, a guided Listen/read, Answer, Review
and send page with typed answers as the default, localized acknowledgment labels and
receipts, and review-before-send. Supervisor Responses exposes an Acknowledged filter
and a receipt view (time and published key facts, no fabricated question or
submissions). The acknowledgment-only notice states plainly that neither a matching
answer nor an acknowledgment certifies understanding or safe work.

Browser evidence used the in-app browser at 634x473 against synthetic fixtures: Maya
sent a canonical text acknowledgment instruction to all 30 workers (Delivered 30 of 30),
worker-029 acknowledged in Urdu with a localized receipt and Done state, and the
supervisor saw the acknowledgment filter and receipt. A typed question flow was also
run through the review step. Focused tests passed 10/10, `npm run typecheck` passed and
`npm run build` passed (6.2 s) with only the known chunk-size and
INEFFECTIVE_DYNAMIC_IMPORT warnings.

The first full-suite run after these changes exposed three backup/import failures,
because the synthetic SQLite-to-PostgreSQL import rejected the two new tables as an
unsupported schema. Fixed by adding migration
`096_instruction_modes_and_acknowledgments.sql` with guarded PostgreSQL tables, real
acknowledgment reads in the PostgreSQL response detail and list models, import
validation and row copying for both tables, and the matching runtime permission policy
(application writable tables 122, worker 96). The same run exposed a scheduled
publication defect: the schedule verifier compared raw prepared content with a snapshot
hash that now includes instruction modes. Content verification now accepts the raw
prepared hash or the mode-normalized hash in both SQLite and PostgreSQL. Affected suites
pass: runtime permissions 24/24, PostgreSQL/import/instruction/authorization 59/59,
publication schedules and pipeline rehearsal 15/15. A clean full-suite rerun is still
required before claiming a current total. PostgreSQL still writes instruction sends and
acknowledgments only through the SQLite path; the PostgreSQL tables and read/import
models exist for parity, while worker password identity, server-persisted language,
14-locale resources and automatic capture remain the next phase. Nothing was deployed;
no real invitations, push messages, paid providers or worker data were used.

## Final Accessibility And Clean-Suite Checkpoint

22 October 2026: the final browser accessibility sweep covered 38 public, staff and
worker screen states in the in-app browser (about 634x473, synthetic demo data). It
found zero structural issues, zero unnamed controls, zero duplicate ids, zero heading
skips, zero landmark problems and zero contrast failures after fixes. Localized staff
and worker skip links are first in tab order, appear at the top when focused, and move
focus to the main landmark; the public skip link already existed. Muted metadata and
page-footer text were darkened from failing colors, amber status text moved from 3.2-4.2:1
to about 5.1:1, and select, worker-switch, checkbox-label and overview title-button
targets were raised to at least 24px. Controls still below 24px are wrapped by 48px
labels, are radios inside full-row labels, or are a visually hidden file input with a
visible label. Public header/footer text links remain 16-18px high but meet the WCAG
2.5.8 spacing exception (at least 26px between centers). This is a heuristic DOM/CSS
audit, not a WCAG certificate; screen-reader, keyboard-only end-to-end, 200% zoom/320px
reflow, forced-colors and physical-device sessions remain open.
Evidence: `artifacts/a11y-2026-10-22/results.json`.

`npm run build` passes after the final CSS changes (2.4 s) with only the known
chunk-size and INEFFECTIVE_DYNAMIC_IMPORT warnings. The focused UI source suite passes
19/19. The clean full single-process run reports 1,350 tests: 1,346 pass, 0 fail and 4
native skips (`artifacts/full-suite-2026-10-22-run2.log`); this supersedes the earlier
checkpoint's one load-sensitive restore-retention failure, which passed in isolation and
was not reproduced. Production readiness is unchanged: synthetic-only, not deployed,
with public DNS/ACME, hosted Neon connectivity, monitoring, real-data provider/privacy
approval, production backup rehearsal, independent security review, physical-device/AT
testing and deployment authorization still open.

## Runtime Packaging Verification Checkpoint

22 October 2026: the packaged runtime was exercised locally with synthetic data only.
The Docker image built successfully and runs as uid 1000 `node` with no environment
files inside it. The API container rejected missing or altered proxy headers, direct
access from an untrusted network and HTTP forwarded-protocol spoofing, and served the
self-only CSP, HSTS, nosniff, revalidated HTML and immutable hashed-asset contract.
Caddy 2.10 validated both deployment configurations; a local TLS run with Caddy's
internal CA confirmed HTTPS, a 308 HTTP-to-HTTPS redirect, and overwrite of spoofed
multi-address `X-Forwarded-For` and `X-Forwarded-Proto: http`. The native
`pg_dump`/`pg_restore` round-trip gate passed against a disposable PostgreSQL 18.6 TLS
cluster (1/1, 17.9 s), including private-object readback, quarantine and immutability;
the scratch databases were removed afterwards. `npm audit --omit=dev` reports zero
vulnerabilities and a repository secret scan found no credential material outside the
gitignored environment files. Public ACME issuance/renewal, deployed Neon connectivity,
hosted concurrency and the independent release gates remain unverified. This is not a
production-readiness certificate. Evidence:
`artifacts/runtime-verification-2026-10-22.json`.

## Reference UI Parity And Provider Verification Checkpoint

22 October 2026: the 47-reference screenshot audit is complete and the remaining UI
deltas were implemented and checked in a real browser against the disposable PGlite
demo. Organization settings now show the signed-in owner name/role/email, workspace
status, support contact and explanatory note; site settings show the timezone, EN/AR/UR
language tags, primary/deputy contacts and revision. Staff access requests 50 invitation
rows through a page-size-aware validator and keeps failed email delivery inside the
dialog with an inline error. Glossary detail shows the locked-revision notice
("Saved revisions are locked and cannot be edited..."), verified by creating a synthetic
term and viewing v1. The operator Providers & quotas screen was verified against the
fresh dist through the disposable operator fixture: credentials missing, all seven
pipeline stages disabled, fixed synthetic tests blocked by server configuration, quota
save disabled pending confirmation, zero reserved operations and actual cost
"Not reconciled"; no fabricated spend or readiness. `npm audit --omit=dev` reports zero
vulnerabilities, and a dist/src scan found no key material. `npm run build` passes in
about 12 s with only chunk-size/INEFFECTIVE_DYNAMIC_IMPORT warnings. The full
single-process suite (230 files) reports 1,350 tests: 1,345 pass, 1 fail and 4 native
skips. The failure was `accounted production cleanup chains each commit and all six
removals...` in tests/restore-retention.test.mjs; the same test passed on an isolated
rerun (1/1, 73 s) and was consistent with the sweep's 120 s bound under a loaded host,
not a reproduced functional defect. This is a load-sensitive suite flake, not a
production-readiness certificate. Production readiness is unchanged: synthetic-only
and not deployed; public ACME/DNS, hosted Neon integration, a deployed
backup/retention drill, real-provider data and physical-device/assistive-technology
audits remain unverified. The runtime checkpoint above supersedes the earlier
"image not built / Caddy not started" status.
Evidence: artifacts/final-verification-2026-10-22.json.

## Hybrid Voice Rehearsal Checkpoint

22 October 2026: the full synthetic voice business workflow was exercised through the
real browser UI against an isolated local PGlite workspace. A supervisor voice upload was
transcribed by Gemini, prepared with MiniMax M3.1 Flash (free) text plus Gemini speech,
and published as v1 to one worker. The worker redeemed a one-time access link, recorded a
synthetic WAV through the browser recorder, and the answer was transcribed by Gemini and
assessed by MiniMax against the frozen rubric: matched all three key facts with exact
evidence. No real worker data, public endpoint, deployment or production approval was
involved. `npm run build` passes; focused OpenRouter/preparation/recording/hosted/deploy
tests pass; `tests/generated-audio.test.mjs` passes 31/31 in isolation (one 300s timeout
under parallel shard load, not a failure). Hosted provider dispatch remains fail-closed by
`hosted-config.mjs`, so the hosted staging package stays a non-AI synthetic shell until a
separate security review approves provider execution. Demo entry point:
`scripts/ui-demo-server.mjs`; credentials and evidence stay under gitignored `artifacts/`.

## Deployment Package Checkpoint

21 October 2026: a local-only synthetic staging deployment package is ready for host
configuration, but nothing is deployed or published. It adds a multi-stage Dockerfile,
Compose API/worker plus optional separate operator profile, Caddy TLS/header overwrite,
an offline deploy preflight and docs/DEPLOY_RUNBOOK.md. The Docker build stage now
copies `server/`; without it the TypeScript build fails on server imports. Four-shard
suite:1,343 tests/1,339 pass/zero fail/four skips; the three real-PostgreSQL skips
were then run against a disposable local PostgreSQL16 container and passed (3/3),
leaving only the native pg_dump/restore backup test skipped. Clean build,
production-only dependency check, exact Docker build context and both compose
profiles pass. A
throwaway PostgreSQL18.4 cluster:95 migrations applied, all three current ACL profiles
configured, and each hosted check passed over certificate-checked TLS; API health/
static/proxy rejection, worker health publication and separate operator-origin denial
passed.
Preflight (with the populated local loopback contract) reports
ready:true/deployed:false/productionReady:false with zero network requests. Docker image build, Caddy TLS issuance, DNS, Neon integration, backups and
live AI remain unverified because registry blob downloads stalled. This is deployment
preparation, not production readiness. Evidence:
artifacts/deploy-validation-2026-10-21.json. Earlier checks below are historical. No
cloud account, host, billing, real data or public endpoint was used.

## Previous Reports Checkpoint

21 October 2026: EN/AR/UR Reports/publication history/export recovery and scoped
shell are implemented.30 built locale-width checks, keyboard held-read focus,
localized failures, byte-identical CSVs and exact interrupted create/retry
recovery pass locally. Corrected cleana16e0668 parent71025 observedexit0:
1,342 tests/1,338 pass/zero fail/four native-only skips, offline build/evaluations,
915 stable source files. Overall82% (was81%), report/export90% (was85%), broader
localization63% (was60%). Full reference/independent language/AT/phone/native/
hosted/privacy gates remain; see docs/REPORT_LOCALIZATION.md. Earlier notes below
are historical. Original data/root dist remain untouched; no cloud/live provider.

## Previous Composer And Worker Lock Delta

21 October 2026: new generated staff drafts now use500 characters; ordinary
messages and captured requests retain1000. Over-limit mode changes preserve text
and block sending with EN/AR/UR errors. Actual expiry locks in selected Urdu;
identity mismatch locks in selected Arabic, removing private controls. Focused30
checks and isolated build pass. Clean326a25fd parent47743 exits0:1,335 tests,
1,331 pass/zero fail/four native skips; offline build/evaluations and913 stable
source files. Guarded evidence writer passes; original data/87 saved manifests
preserved. Current report: artifacts/production-conversation-policy-2026-10-21.json.
Overall81% unchanged; detailed evidence/limits: docs/CONVERSATION_COMPOSER_LIMITS.md.
Earlier checkpoint notes below are historical. No cloud/live provider/real mic.

Fresh user preview: http://localhost:3250/api/qa-staff, hiddenPID19556,
started21 October15:44:14 Beirut,20-minute TTL. Accepted clean326 assets,
memory-only synthetic data/fixed tones, queue-only follow-up; no live speech.
CUA tab33 verifies0/500 and is retained. Screenshot:
artifacts/conversation-policy-user-preview-2026-10-21.png. Recheck after TTL;
original3020/data/root dist unchanged. Next large local task: EN/AR/UR Reports,
publication history and export-recovery UI; preserve exact command/CSV semantics.

## Previous Staff Action And Focus Checkpoint

21 October 2026: inspected selected S15 JPEG#15 again. Generate/send and private
recording now share an action row, with a unique explicit message form owner;
recording dialogs stay outside the form. The existing1000-character limit now
has a linked visible counter. Private-history paging/manual refresh focuses a
persistent heading before removing controls; a stable status announces loading/
page counts without retaining unverified private rows. Three source regressions
failed before the repair; focused17 checks and an isolated optimized build pass.
This is newer than clean9db95d02; current acceptance is recorded below.
Overall remains81%; broader release gates remain open.
QA will use localhost on3243 so it does not replace the live127.0.0.1 worker
preview's cookie. No original data, cloud, real mic, provider or billing changes.

Preliminary findings retained: shared panel styles gave the submit group a16px
top margin; a new regression failed before the margin reset, then focused18
checks pass. Preliminary viewport commands resized the control tab, leaving the
app at1280; those measurements and the misleadingly named1585 image are not
accepted. Configured final fixture3245 exposes synthetic queue-only generation,
not a running provider. Corrected built13 actual viewport measurements pass;
three-language history focus, failed-read/recovery, draft continuity and exact
keyboard form submission pass. Clean5285225b parent69003 exits1 solely because
source changed:1,332 tests/1,328 pass/zero fail/four skips and evaluations pass,
but sourceUnchanged=false. It is not accepted.

Corrected clean4b338be1 parent9027 observed exit0:1,333 tests/1,329 pass/zero
fail/four native-only skips, offline install/build, mocked/scripted evaluations,
913 stable source files, SHA6012cb5cfebcf10f1b115248b1775fab514aa1474f4a2a0005c6292fd7b6f407.
The corrected action row passes13 retained locale-width measurements, including
1585x992 desktop; it wraps without overlap at320/390. Keyboard paging focuses
the persistent history heading through held/failed/recovered reads. Arabic/Urdu
paging and cross-language draft/counter continuity pass. External form keyboard
submit creates one queued synthetic follow-up; a separate private save preserves
that job, original attempt/receipt and open status. Worker external submit also
creates exactly one reply, no answer/audio. Staff66584 and worker50461 fixture
parents actually exit0 after owned stop; viewport reset and QA tabs closed.
Source/build/evidence: artifacts/staff-actions-aligned-browser-final-2026-10-21.json,
worker-conversation-external-submit-2026-10-21.json and the current clean result.
Follow-up fixture is queue-only, not provider or delivered-speech acceptance.
Overall81% unchanged, staff recording90% (was85%), case detail/recovery92%
(was90%). No full matched-reference/independent language/AT/phone/current95
native/hosted/privacy release claim. Prior user preview3242 has reached its TTL;
do not report its old URL as live without rechecking.

Guarded checkpoint writer observed exit0: current913-source digest and corrected
candidate/clean manifests match, all13 staff/four worker layout readings plus
focus/form/terminal evidence checked. Preservation979b0750 exits0: original eight
hashes match, integrityOK/FK0,85 saved manifests valid,6,493 selected files and
zero configured-secret matches. See artifacts/production-staff-actions-focus-
2026-10-21.json. Next reference gap: distinguish the reference500-character
generated-follow-up input from the existing1000-character message/legacy receipt
contract without truncating private drafts or preventing exact receipt recovery.

Fresh user-facing staff-flow preview is separate from terminal QA: hiddenPID16736,
started21 October15:22:43 Beirut, localhost:3247,20-minute TTL, accepted clean4b
assets, disposable memory data/fixed-tone microphone only. Follow-up capability
is synthetic queue-only, not live generation. CUA tab29 verifies the controls and
is retained. URL: http://localhost:3247/api/qa-staff. Screenshot:
artifacts/staff-actions-user-preview-2026-10-21.png. Recheck liveness after TTL.
Next QA should use127.0.0.1 while this localhost preview is live, to preserve
its host-scoped rehearsal cookie. Original3020/data/root dist remain unchanged.

## Current Purpose And Failure-State Checkpoint

After the accepted81% checkpoint below, Help/reply permission, conversion,
uncertain-receipt and lazy-render fallback copy is now purpose-specific in all
three interface languages. Answer and staff-purpose copy remain separate.
This four-source-file follow-up passes focused9 checks and clean9db95d02,
parent67671 observed exit0:1,329 tests/1,325 pass/zero fail/four native-only
skips, offline install/build/evaluations and912 stable source files,
SHAee2bbd4e90783ce3b5628278d056a3ba9fbcea2a42902edaf7e0129ec51191f2.
Actual built unavailable/malformed/wrong-language notice gates, manual recovery,
three-language permission errors, held storage/timeout/GET storing then received,
corrupt storage/GET failed and context lock pass. Twelve fresh locale-width raw
measurements are now retained. Only one received message and one failed recording
are added; original attempt and submission-receipt count remain unchanged.
Failed private bytes remain pending cleanup; no physical-erasure claim.
Fixture13456 observed exit0 after owned stop; initial inaccessible sandbox fixture
79027 was identity-checked and stopped with exit1, not accepted browser evidence.
No security protection was weakened: the replacement loopback fixture runs on the
host under the normal reviewed local-server execution path.
Overall81% unchanged; voice recovery90% (was88%), navigation/Help90%.
Current browser/layout evidence: artifacts/worker-voice-purpose-browser-final-
2026-10-21.json and worker-voice-purpose-layout-2026-10-21.json. Permission copy
was rendered; format/lazy-error copy has dictionary/wiring tests, not injected
render crashes. Session-lock fallback still renders English. Wider language/AT/
reference/phone/current95 native/hosted/privacy/release gates remain open.
Preservation35bc3ecd exits0: original eight hashes unchanged,81 saved manifests
valid,6,229 selected files/zero configured-secret matches. Older checkpoints below
remain historical evidence, not the current selected-source digest.

Guarded purpose-checkpoint writer observed exit0; source and candidate/clean
manifests match. See artifacts/production-worker-voice-purpose-2026-10-21.json.
Fresh user-facing worker-flow preview is separate from terminal QA: hidden
PID2540, started21 October14:47:44 Beirut, port3242,20-minute TTL, accepted
clean9db95d02 assets, disposable in-memory synthetic data and labelled fixed
tones only. This is not production data or physical-microphone validation.
URL: http://127.0.0.1:3242/api/qa-worker-voice. Liveness must be rechecked after
TTL; original3020/data/dist remain unchanged.

## Current Worker Voice Checkpoint

21 October 2026 accepted local checkpoint: explicit EN/AR/UR worker notice projections remain
separate from profile/frozen assignment languages. Both backends and the actual
HTTP client require the captured worker context; all online recorders use the
bounded strict notice reader. Offline snapshots explicitly select their frozen
notice language and allow authorized mixed-language assignments without relaxing
worker/session identity or notice/scope checks. Two language regressions failed
before the fix and pass afterward; the new offline test exposed and corrected
the old profile-equals-assignment restriction. Focused18/14/22 checks pass.

Reply capture survives transient reads and closed-conversation receipt recovery;
new captures remain disabled when unavailable. Answer/Help/conversation drafts
interlock without blocking their own continuation. One-click restart is verified
after an actual received reply. Final built pre-answer Help/clear/reload/GET-only
recovery, exact reply retry, Arabic/Urdu capture/notices, supervisor closure and
exact closed-case GET recovery pass with unchanged original worker evidence.
All12 nested recorder/viewport checks pass after repairing the preliminary320px
Help-label overflow. Three isolated builds and preliminary failures are retained.
All browser audio uses a labelled fixed tone with native microphone access denied.
No real worker, cloud/provider/mail/billing/deployment action. Clean77bbf986,
parent80848 observed exit0:1,327 tests/1,323 pass/zero fail/four native-only
skips, offline install/build,43 mocked contracts/ten scripted pipeline checks,
912 unchanged source files. Candidate/clean asset manifests match.
Preservationfc762ea7 parent55947 exits0: original eight hashes unchanged,
integrityOK/FK0,79 saved manifests valid,6,097 files/zero configured-secret matches.
Guarded checkpoint writer exits0. See
artifacts/production-worker-voice-recovery-2026-10-21.json.

Overall81% (74-87 uncertainty), voice recovery88% (was80%), navigation/Help90%
(was89%). Not production ready. Fixture2313 actually exits0: four received
objects/five POSTs (one exact replay), two receipt GETs, one private playback,
one unchanged original attempt and one submission receipt. Its owner deliberately
resolved the case; voice did not resolve it. Native mic remained denied.
Twelve width checks were observed but their raw array was lost at REPL reset;
three screenshots remain, not an independently replayed layout artifact.
A later notice-retry attempt occurred after session/fixture expiry and is not
accepted notice-fault coverage. Purpose-specific Help/reply fallback copy,
rendered notice/storing/failed states, full refs/independent language/AT/phones/
current95 native/hosted/privacy gates remain. Older entries below are historical.

## Current Staff Audio Checkpoint

21 October2026 accepted local checkpoint: the staff-purpose capture, preview, explicit
private save and exact receipt-recovery UI are now implemented, with declared
recording language independent of EN/AR/UR interface language. Focused client/
HTTP contracts18pass; typecheck and isolated optimized builds pass. Final UI
candidate passes all12 locale/width containment checks (320/390/768/1440),
retains the same preview across language changes, and fixes narrow sticky-header
overlap, one-click restart and save/clear focus. Browser testing uses an explicitly
labelled synthetic microphone simulator with native microphone access denied.
Unknown-ack/actual reload/GET-only recovery, native private playback, integrity-
rejected save, read faults, context lock/manual return and10/5-row history pass.
Cleanf4dfba7f-0f7e-44a1-83c7-b4428e49b897, parent3879 observedexit0, finished
2026-10-21T05:53:54.547Z: offline install/build,1,316 tests/1,312 pass/zero
fail/four native-only skips, mocked/scripted evaluations,909 unchanged source
files. Overall80% (73-86 uncertainty), staff recorder85% (was0%), case detail/
recovery90% (was88%). History pagination focus and exact reference action
placement remain; not physical-device, independent language/AT, current95 native,
hosted or production acceptance. See docs/STAFF_CASE_RECORDINGS.md and
artifacts/production-staff-inperson-recording-2026-10-21.json. Original data,
saved builds and configured-secret absence are guarded by its preservation
report. Earlier in-progress observations below are historical, not current status.

Checkpoint writer observedexit0 and verifies the current source plus candidate/
clean asset manifests. Preservationb4d23492, parent64537 observedexit0: original
eight table fingerprints unchanged, integrityOK/FK0,75 saved manifests valid,
5,841 selected files/zero configured-secret matches. Both owned QA fixtures are
absent; their lost final parent handle is not reported as exit0. CUA tabs are
closed and viewport reset; original3020/root dist remain untouched. No cloud,
provider, mail, real worker data, actual mic, billing or deployment action.

Fresh user preview is intentionally separate from terminal QA: hiddenPID7016,
started21 October09:12:27 Beirut, port3237,20-minute TTL, accepted clean-built
UI, isolated in-memory synthetic data and labelled fixed-tone microphone only.
CUA tab8 verifies the loaded staff notice/recording controls and is retained.
URL: http://127.0.0.1:3237/api/qa-staff. Preview proof/status are
artifacts/staff-recording-user-preview-2026-10-21.png and the matching.json.
This is not persistent production data or real microphone validation. Liveness
must be rechecked after its TTL; original3020/data/dist remain untouched.

Earlier21 October2026 resume in D:\understod: S15 staff-audio backend is implemented
in the dirty working tree, not yet a completed recorder feature. Focused both-
engine/HTTP tests11pass, privacy/import/timeline39pass, separate-role checks3pass
and ledger author-binding1pass were observed. Original worker evidence is not
replaced. Migration095, privacy ledgerv8, private receipts/reads, cleanup, local
backup/restore/import and worker cleanup-column ACLs are in progress. See
docs/STAFF_CASE_RECORDINGS.md. Last fully accepted overall estimate remains79%;
the capture UI and browser recovery are not implemented yet.

First clean1dd4ebcb finished exit1:1,309 tests/1,302 pass/three failed/four
native-only skips. Two remaining094 migration-count assertions were corrected.
The worker-freshness test passed unchanged alone; its150ms completion assumption
was removed by accelerating only intentional staleness and using the unchanged
production30s window for admission/recovery. All three focused repairs passed.
Fresh clean488a9862-c757-4979-a0a6-ce7531d36d45 installed/built successfully,
but was interrupted during tests. Handle51919 is now missing; result.json still
says running and the log has no terminal summary. It is NOT accepted or blindly
restarted. Saved905-file snapshot remains intact. Preservation1a057320 exit0:
original eight table fingerprints unchanged, integrityOK/FK0,69 manifests valid,
5,461 selected files/zero configured-secret matches. No cloud/provider/mail/mic/
billing/deployment action. Old preview TTLs have not been revalidated; no current
preview liveness is claimed. Next concrete task: real staff-purpose capture/
preview/save UI, immutable declared language, exact browser receipt recovery and
case-action/navigation interlocks, then fresh combined verification. Historical
accepted checkpoints below are retained, not current-source acceptance.

## Current Timeline Checkpoint

20 October2026: real paged S15 timeline implemented for both engines, with
staff-only captured-session HTTP/strict client projection, chronological real
events, no private message/note/reason text, no unrelated-case repeat answers,
and audit-identity expiry respected. Browser attribution/paging/draft continuity,
read faults/recovery/context lock and EN/AR/UR four-width containment pass.
Fixtures88439/87668 exit0; tabs closed/viewport reset. Full in-person recorder
is still absent. Overall79% (72-85 uncertainty), case detail/recovery88% (was85%).
The local timeline slice is accepted; this is not full S15/release acceptance.

Review caught initial-route clock copied from historical case creation. Added
SQLite/PG regression fails twice as intended; query now uses the actual scoped
clarification.routed audit timestamp. Corrected focused17tests pass/zero fail.
Cleaned248d49 exec74180 finished exit1: all five steps pass,1,296 tests/1,292
pass/zero fail/four skips, but source-change guard correctly rejects the prior
snapshot. Fresh cleand1edbaef-824b-4f4b-841a-12fa19904971,exec97723, observed
exit0, finishes2026-10-20T18:19:51.060Z: offline install/build,1,296 tests/1,292
pass/zero failed/four native-only skips,300785.0291ms;43 mocked contract cases,
ten scripted pipeline checks,24 scripted/zero external requests. Corrected
source896files unchanged/SHAea9d234fd38886eac83cab9bf8b65d4b431f1e57908ba45482a9e0ae1628e64c.
Browser candidate assets exactly match the corrected clean build; the server-
only clock repair is covered by the both-engine late-routing regression.
Preservation62dab9f0 exec82051 exit0: original fingerprints unchanged,68 saved
manifests valid,5,381 selected files/zero configured-secret matches.
No cloud/provider/mail/microphone/billing/deployment. See docs/CASE_TIMELINE.md
and artifacts/production-case-timeline-2026-10-20.json. Earlier checkpoints
below predate this work. Next: actual private staff in-person audio and its
authorized receipts/recovery, original-evidence preservation and privacy/
retention/backup integration on both engines. Real worker AI stays off Free.

Fresh user preview: hiddenPID18612,started20 October2026 21:20:15 Beirut,
port3233,20-minute TTL,.tools/start-case-timeline-user-preview.mjs. Exact
cleand1ed built UI/current source. CUA tab17 verifies timeline chronology and
actor labels; one detail/one timeline/two workflow reads,zero mutations/external
calls, original attempt unchanged. User tab retained; original3020 untouched.
Evidence: artifacts/case-timeline-preview-status-2026-10-20.json and
case-timeline-user-preview-2026-10-20.png. This intentional user preview is
running, not an unfinished required QA session. Prior language preview expired.

## Current Local Case Language Checkpoint

20 October2026: EN/AR/UR clarification queue/create/detail and action/repeat/
review/deadline/dialog interfaces are implemented and locally browser-checked.
Private content, captured authority, request intent and receipt recovery remain
unchanged across UI language switches. Repeated-hour deadline, actual synthetic
case/review saves and uncertain owner-save GET recovery pass. Queue composition
follows inspected S14. S15 timeline and staff in-person audio remain unfinished.
Clean50987288-24b1-47b0-8f98-c60a50af566d, exec40194 observedexit0, finishes
2026-10-20T17:51:41.730Z: offline locked install/build,1,290 tests/1,286 pass/
zero fail/four native-only skips,304943.0671ms;43 mocked contract cases,ten
scripted pipeline checks,24 scripted/zero external requests. All890 source
files unchanged, SHA ee2b833090b166848bbd53eb3f128639e3bc3604f88578f264fbadffd8fb777a.
The browser candidate asset manifest exactly matches this clean build.

Required synthetic browser fixtures4638/4794 exited0; tabs closed and viewport
reset. Corrected GMT offsets, actual independent creation/disagreement/deadline,
uncertain owner save and GET-only recovery, locale draft continuity, Cancel/
editor focus and responsive containment pass. Narrow table scrolling is
intentional. Independent languages/AT/phones and complete reference acceptance
are not claimed. Preservation523d7e94, exec19725 exit0: original eight table
fingerprints unchanged, integrityOK/FK0,63 saved manifests valid,5,054 selected
files/zero configured-secret matches. Schema94 unchanged; no native/cloud/
provider/mail/microphone/billing/deployment action.

Overall estimate79% (72-85 uncertainty), S14 queue/creation80%, application-wide
localization60%. Not production ready. See docs/STAFF_CASE_LOCALIZATION.md and
artifacts/production-staff-case-localization-2026-10-20.json. Next substantial
local task: S15 timestamped case timeline and real staff in-person clarification
recording, preserving original response/evidence and recovery boundaries.
Earlier accepted source hashes below predate this checkpoint.

Fresh user preview: hidden PID1052 started20 October2026 20:52:10 Beirut,
port3233,20-minute TTL,.tools/start-case-localization-preview.mjs, exact clean
50987288 build. CUA verifies current queue/locale control; one list read,zero
mutations/provider calls,one seeded case/help/attempt and unchanged original
attempt. User-facing tab7 retained. Evidence: staff-case-localization-preview-
2026-10-20.json and clarification-localization-user-preview-2026-10-20.png.
Original3020 application untouched. This preview is intentionally running for
the user, not an incomplete required QA session.

## Current Staff Creation Checkpoint

20 October 2026: the real S14 New clarification workflow is implemented locally
for owners/supervisors on both SQLite and PostgreSQL. Scoped SQL paging, exact
publication/version/latest-completed-answer selection, independent follow-up,
truthful staff provenance, atomic routing/audit/immutable receipts and hash-only
browser recovery preserve original answers and assessments. Worker help and
conversation messages are not fabricated. Queue received/due times, versions
and reason legend are visible. See docs/STAFF_CLARIFICATION_CREATION.md.

Clean8be48ec7-0bd8-41ad-a1a2-833ecf85c2c9, exec28389 observed exit0, finished
2026-10-20T13:43:19.592Z: locked offline install/build, 1,284 tests/1,280 passed/
zero failed/four native-only skips, 374877.4711ms; 43 mocked contract cases,
ten scripted pipeline checks, 24 scripted/zero external requests. All886 source
files unchanged, SHA d130b8b26e06936eee14e072498549f2bccd6ba72cd8aa223853f8c29feb9754.
Initial1708d139 failed three explicit schema-upgrade expected lists missing094;
the fourteen-test focused recheck and full rerun pass. Initial evidence remains.

Final clean-built browser checks cover linked and independent cases, original
matched assessment, existing-case navigation, post-commit malformed reply,
GET-only receipt recovery after local clearing/reload, session-context lock,
Cancel-first clearing and corrected editor focus, plus320/390/768/1440 control
containment. Preliminary checks cover changed-intent retry denial, newer draft
preservation, malformed selected reads and navigation guard. Two final creation
POSTs produce two cases; original attempt hash is unchanged, no extra help/
messages/answers, zero external calls. Both required fixtures exited0 and tabs
are closed; viewport restored. This is local CUA evidence, not Reticle/native/AT.

Preservation986edabb, exec70990 exit0: original eight table fingerprints match
priorf6981c31, integrityOK/FK0, all60 saved manifests valid,4,857 selected files/
zero configured-secret matches. Root database/dist and prior builds remain intact.
Schema094 and new journal permissions are local only. Historical native91 does
not accept94. No cloud, live provider/mail/microphone, billing or deployment.

Overall estimate78% (71-84 uncertainty); S14 staff-created cases/queue70% (was20%).
Not production ready. Full S14/S15 reference composition and EN/AR/UR staff
localization remain next, followed by wider AT/phone/native/hosted/privacy/release
gates. Evidence: artifacts/production-staff-clarification-creation-2026-10-20.json.

Fresh user preview: hidden PID29780, started20 October2026 16:46:26 Beirut,
port3233,20-minute TTL,.tools/start-staff-creation-preview.mjs. Verified exact
accepted clean-built UI and expanded reason legend; one list read and zero
creation/action/repeat/review POSTs, zero external calls, unchanged seeded
attempt hash. One synthetic help case/answer only; no original data used.
URL http://127.0.0.1:3233/api/qa-clarifications is a fresh-session entry.
The preview tab is kept for the user; all required QA tabs/commands are terminal.
This is an intentional temporary preview, not a production service.

## Previous Worker Case-Permission Checkpoint

20 October2026: worker SQL case_reviews now permits SELECT/UPDATE(reason) only;
case_repeats permits SELECT/UPDATE(status) only; review sequence authority is
removed. Exact existing evidence guards and all current/future column grants
are checked at startup/configuration. API/operator grants and schema093 are
unchanged. Worker policy:85 ordinary-DML/nine column-restricted/34 read-only/
ten hidden tables. Trusted status operations and wider worker read/row authority
remain limitations,not complete compromise isolation. See
docs/WORKER_CASE_WORKFLOW_PERMISSIONS.md.

Fresh clean b187180f-c7f2-4543-86bf-5da2735f421b,exec26533 observedexit0,
finished2026-10-20T12:57:42.245Z: offline locked install/build,1,269 tests/
1,265 passed/zero failed/four native-only skips,341306.9823ms,43 mocked
contract checks/ten scripted pipeline checks,24 scripted/zero external requests.
All877 source files unchanged,SHA
f2a5a4d74c4535eb593b93b5f51a3a0647b3821c964aa67d6356fbd0509a877f.
At that checkpoint the source matched the snapshot. Frontend manifest was byte-identical
to accepted84afc9af; no new browser or native pass is inferred from backend tests.

Focused41 regression checks and five final guard/fence checks pass. Actual
separate API/worker identities complete typed and private recorded repeats,
transcription/assessment, verified private-audio removal, deletion redaction
and populated resolved-case retention. Receipts/hashes and assessment identity/
outcomes remain intact. Worker creation/deletion/evidence-column/sequence writes
are denied; broad/delegated/PUBLIC/future-column/sequence/guard drift is rejected;
preceding broad-grant reconfiguration and post-fence cleanup denials pass.

Initial clean8773ed18,exec81472 observedexit1,had one Windows UNKNOWN lstat
error on a temporary backup manifest:1,264 passed/one failed/four skipped.
Its exact unchanged backup test passed alone,then the unchanged full source
passed fresh clean b187180f. Cause is not proven; safety checks were not weakened.
Both snapshots and the focused-recheck log remain preserved.

Preservation f6981c31-a726-46e0-9971-28f664d03bab,exec86787 observedexit0:
original eight table fingerprints match prior560b8f87,integrityOK/FK0,58 saved
manifests valid,4,714 selected files/zero configured-secret matches. Root data/
dist preserved. Required verification sessions terminal. No cloud/native ACL,
provider/mail/microphone/billing/deployment action. Native91 does not cover
this newer schema93 worker policy. Reticle refusal remains respected.

Overall77% unchanged (70-83 uncertainty); service permissions83% (was82%).
Not production ready. Reference reinspection confirms S14 New clarification
is missing and received/due fields are not displayed. Next major local task:
real staff-created scoped cases with truthful provenance and durable recovery,
queue metadata/reason legend and complete interface localization. See
artifacts/production-worker-case-permissions-2026-10-20.json and progress board.

Fresh user-facing synthetic preview: hidden PID19556,started20 October2026
15:59:43 Beirut,port3231,.tools/start-worker-case-preview.mjs,20-minute expiry.
HTTP200/exact accepted customer-aWyVo-6g asset and fresh zero user POSTs/receipt
reads/external calls verified. Seeded14 attempts/12 reviews/13 repeats remain
memory-only synthetic records. URL http://127.0.0.1:3231/api/qa-clarifications
queued in Codex. It is an intentional temporary preview,not native-role/browser
security proof,a required QA command or a production service. Older preview
addresses/PIDs below are historical; check actual liveness before reuse.

## Previous Repeat And Review Checkpoint

20 October 2026: captured repeat-answer and supervisor-review contracts, paged
histories, exact-intent recovery, unsent draft continuity and explicit site-civil
deadline handling are locally implemented and verified. Pending unknown outcomes
are never automatically resent; GET-only receipt recovery preserves newer and
unrelated drafts. Legacy review metadata remains recoverable without persisting
private reasons. See docs/CASE_WORKFLOW_RECOVERY.md.

Clean84afc9af-b6c6-450c-b967-8c0e6123137f completed at
2026-10-20T08:15:04.489Z: all five steps exit0, locked offline install/build,
1,265 tests/1,261 passed/zero failures/four native-only skips,351585.3563ms;
43 mocked contract cases/ten scripted pipeline checks,24 scripted provider
requests/zero external calls. All876 source files unchanged, SHA
a66aeb605043da1fc2a84740cc2cc934d099b5865a176851dbc141f6a95c0ed1.
The original command handle14833 was unavailable after continuation; terminal
result.json and every child exit are present, not an observed parent exit code.
The exact clean-built customer-aWyVo-6g / Clarifications-BgJqoT_H was tested.

Focused22 client/domain and three actual HTTP/session tests pass. Built English
QA covers both history pages, malformed/failing reads, changed-draft retry denial,
malformed post-commit replies, GET-only recovery, newer/unrelated text preservation,
competing repeat rejection, stale deadline/rebase and local Cancel/focus clearing.
The two repeated-hour deadlines persist as05:30Z/06:30Z with visible GMT-4/GMT-5.
Unsent repeat dates block navigation. Current-session mismatch locks the view.
Initial native-date input synchronization and320/390 notice overflow defects were
fixed; exact clean assets fit320/390/768/1440, including shorter occurrence labels
and separated forms. This is not complete localization/AT/phone or Reticle proof.

Corrected-input fixture40778 exited0:two repeat/four review POSTs,two workflow
receipt GETs,one competing repeat/two fixture deadline changes/one typed answer;
17 reviews/15 repeats/15 attempts,original attempt unchanged,zero external calls.
Pre-polish final5754 exited0:one repeat/one review POST,two GET receipts,one fixture
deadline change;14 reviews/14 repeats/14 attempts,original unchanged,zero external.
First clean-build fixture32171 expired while its handle was unavailable; its final
counters/exit code were not captured. Saved UI measurements prove its layout and
distinct saved deadlines, not terminal inventory. Fresh clean-build48642 exited0:
zero POSTs/three workflow reads,unchanged seeded12 reviews/13 repeats/14 attempts,
original unchanged,zero external. Temporary QA tabs closed/default viewport restored.

Preservation560b8f87-de76-4cc3-b8a6-c86b62331d66,exec6079 observedexit0: original
eight table fingerprints match prioraf456a93,integrityOK/FK0,56 saved manifests
valid,4,584 selected files/zero configured-secret matches. Root data/dist preserved.
No new migration/grants: current93 remains local-only; native91 is historical.
No cloud/provider/mail/microphone/billing/deployment action. Reticle refusal respected.

Overall77% (was76%;70-83 uncertainty),repeat/review task85% (was40%). Staff root
recovery85%,S20/S24 navigation89%,voice80%,service permissions82% unchanged.
Not production ready. Next local work: further worker positive-verb/column
permissions and remaining full-reference/localization/accessibility/device gates.

User-facing synthetic preview: hidden PID29016,started20 October2026 15:34:55
Beirut,port3230,.tools/start-case-workflow-user-preview.mjs,automatic20-minute
expiry. HTTP200/exact clean customer-aWyVo-6g and zero user POSTs/receipt reads/
external calls verified before handoff. Seeded14 attempts/12 reviews/13 repeats
are synthetic fixture records,not original worker data. URL
http://127.0.0.1:3230/api/qa-clarifications queued in the Codex browser panel.
It is an intentional temporary preview,not a required QA session or production
service. Earlier preview addresses/PIDs below are historical; check liveness
and ownership rather than killing a reused PID.

## Previous Clarification Checkpoint

2026-10-20T07:21:40.183Z: staff S14/S15 list/detail/owner/resolution contracts
and A13 recovery slice implemented and locally verified. Strict scoped DTOs,
captured context, owner compare-and-set, immutable applied/unchanged/rejected
receipts and audit-atomic exact replay work on both backends. Historical SQLite
recorded-assessment reasons/evidence remain readable without wrapper metadata.
Drafts survive same-case refresh/failure and older receipt recovery; confirmed
local reset restores focus and never cancels pending work. Resolved root cases
disable a stale new-message composer. See docs/CLARIFICATION_ACTION_RECOVERY.md.

Clean99969805-3771-4838-9131-d16934390367, exec72400 actualexit0: locked offline
install/build,1,254 tests/1,250 passed/zero failures/four native-only skips,
342820.8153ms;43 mocked contract cases/ten scripted pipeline checks,24 scripted
provider requests/zero external calls. All869 source files unchanged, SHA
11c2518e3887ee591570047baf83e54a006a375375f847697f618acf9ee3b170.
Final customer-CFO7RqBu UI manifest/shell matches clean. Focused16 contract/
domain tests, populated historical import, HTTP session fences and policy checks
pass. Initial clean4eb1109e failed three stale count assertions; corrected
clean d5a69f1e passed before the final SQLite compatibility fix. Both preserved.

Built English staff QA covers failed/malformed reads, unsent navigation guard,
owner conflict/rebase, pre-commit failure, malformed post-commit replies,
GET-only recovery, changed-draft retry denial and preservation of newer notes.
Final320/390/768/1440 fit, Cancel/focus/reset, child conversation continuity,
delayed selection and returned-context lock pass. Initial fixture90410 exit0:
four action POSTs/three receipt GETs/three receipts/one fixture owner change;
final77316 exit0:one action POST/one receipt GET/one receipt. Both:two cases,
zero other POSTs/attempts/messages/reviews/repeats/external calls. Tabs closed
and viewport reset. Not full staff localization, independent AT/phone or native.

Preservation af456a93 exec1458 actualexit0: original eight table fingerprints
unchanged, integrity OK/FK0,52 saved manifests valid,4,330 selected files/zero
configured-secret matches. Original root data/dist preserved. No cloud,
provider, mail, microphone, billing or deployment action. Prior Reticle egress
refusal remains respected; local CUA evidence is not Reticle proof.

Overall76% (was75%;69-82 uncertainty), staff clarification recovery85%,
S20/S24 navigation89%, voice recovery80%, service permissions82% unchanged.
Not production ready. Current93 migration/role policy has local evidence only;
preceding native91 acceptance does not cover92/93. Next local work: captured
repeat-answer and supervisor-review requests, draft continuity and recovery.

User-facing local preview: hidden background PID30608, started20 October2026
10:25:50 Beirut, port3224, .tools/start-clarification-preview.mjs; automatic
20-minute expiry. HTTP200/exact customer-CFO7RqBu and fresh zero-action/zero-
external counters verified before handoff. URL
http://127.0.0.1:3224/api/qa-clarifications opens the synthetic staff workspace.
This intentionally running preview is not a required verification command or
production service. Older preview PIDs/URLs below are historical; do not kill
reused PIDs and check actual liveness before reuse.

## Previous Voice Checkpoint

2026-10-19T15:32:58.975Z: captured voice Help/reply contract and recovery,
S15/S24 and A05/A06/A09/A13/A17/A18 slices. Strict session/assignment/case/digest/
stage checks, immutable WAV snapshots, GET-only receipt recovery and localized
failures implemented. Hash-time scope/authority changes cannot retain metadata
or send audio. Confirmed local preview discard preserves pending metadata and
does not cancel uploads/delete server audio. Full recorded-audio discard and
unknown-upload browser journeys are NOT verified; no microphone permission or
capture was used. See docs/VOICE_CONVERSATION_CONTRACT.md.
Clean f35bb4ae-dfcd-4823-bbaf-6e3d7cb2d2ca, exec34947 actualexit0: locked offline
install/build,1,237 tests/1,233 passed/zero failures/four native-only skips,
344968.801ms;43 contract/ten pipeline checks,24 scripted/zero external requests.
All859 source files unchanged, SHA
31d39f8509a4f028a4b28871c8ef847a5e1e6dbb09d9d0ededd98b5c3548d7bf.
Final customer-Bw9Eqzxd preview matches clean. Eight client/recovery and six
actual PGlite/HTTP voice tests pass; combined18 client/recovery pass. Built
EN/AR/UR320/390/768/1440 control/notice and text/voice interlock checks pass.
Fixture41878 actualexit0:zero business POSTs/private objects/attempts/external
requests,23 seeded messages/nine cases unchanged; tab closed/viewport reset.
Preservation f56a3179 actualexit0: original eight table fingerprints unchanged,
integrity OK/FK0;47 saved build manifests valid,4,026 selected files/zero
configured-secret matches. Root data/dist preserved. All verification sessions
terminal. Existing Reticle external-egress refusal remains respected.
Overall75% (68-81 uncertainty), S20/S24 Help/navigation89% (was88%), voice
contract/recovery task80%, service permissions82% unchanged. Not production
ready. No cloud/provider/mail/microphone/billing/deployment actions. Next local
work: staff clarification list/detail/ownership/resolution captured requests
and draft continuity, then repeat/review recovery and remaining release gates.

Latest user-facing synthetic preview: background PID25512, started18:35:33
Beirut, port3221, wrapper .tools/start-voice-contract-preview.mjs;20-minute
automatic expiry. HTTP200/exact accepted customer-Bw9Eqzxd verified, fresh
memory-only data/storage with zero business calls/objects before handoff. URL
http://127.0.0.1:3221/api/qa-navigation?language=en queued in the Codex browser
panel. This intentionally running preview is not a verification command or
production server. Earlier preview URLs below are historical and may have
expired. Recheck actual liveness before reuse; do not kill a reused PID.

## Previous Conversation-Text Checkpoint

2026-10-19T15:08:52.347Z: local conversation text/recovery checkpoint,
S15/S24/S44 and A05/A06/A09/A13/A17/A18 slices. Strict captured-context pages,
message/follow-up receipts, bounded transport and PostgreSQL repeatable-read
lists implemented. Drafts survive unavailable/closed reads; exact GET receipt
recovery preserves different drafts. Local text clearing confirms intent and
does not cancel server work or remove pending metadata. EN/AR/UR notices,
directional paging, isolated names and site-zone timestamps are implemented.
See docs/CASE_CONVERSATION_RECOVERY.md and the conversation browser artifacts.
Clean e8244a1c-bea9-4325-8280-75013d359f83, exec77750 actualexit0: locked offline
install/build,1,231 tests/1,227 passed/zero failures/four native-only skips,
509459.1198ms;43 contract/ten pipeline checks,24 scripted/zero external requests.
All857 source files unchanged, SHA
08d3c375860702a240b52a1758b640ee360cc07a04ae1953ccae4eda52c5c8ae.
Final customer-DWAFuK0s preview matches the clean build. Loaded20-message
EN/AR/UR at actual320/390/768/1440, AR/UR keyboard paging, clear/Escape/focus
fallbacks, localized read failure, malformed DTO recovery, delayed case change
and context lock pass. Initial English QA recovered two explicit uncertain
messages using two receipt GETs, without another POST; closed drafts stayed
visible. Final QA made zero business POSTs; both fixtures exited0 and their
tabs closed/viewport reset. Two initial final-tab attachment timeouts recovered;
two premature screenshot captures are retained but not accepted modal proof.
Preservation dcb6b4ee exec exit0: original eight table fingerprints unchanged,
integrity OK/FK0;45 build manifests valid,3,902 selected files/zero configured
secret matches. Original root data/dist preserved. All verification sessions
terminal; Reticle remains unavailable under the prior external-egress refusal.
Overall75% (was74%;uncertainty68-81), S20/S24 Help/navigation88% (was85%),
service permissions82% unchanged. Not production ready: voice-reply recovery,
repeat/resolution/review and remaining staff clarification migration, full
reference/localization/AT/phone/native-current-policy/privacy/live-quality/
hosted gates remain. Continue locally only; no cloud/provider/mail/billing/
deployment actions. Next: captured voice-reply requests and recovery.

Current user-facing preview: hidden background PID25556, started18:14:03 Beirut,
port3219, wrapper .tools/start-conversation-preview.mjs,20-minute automatic
expiry. HTTP200/exact accepted customer-DWAFuK0s verified; fresh memory-only
23-message/nine-case fixture,zero business/provider calls before handoff. URL
http://127.0.0.1:3219/api/qa-navigation?language=en queued in the Codex browser
panel. This is an intentionally running synthetic preview, not an outstanding
verification command or a production server. Recheck liveness before reuse.

## Previous Help-History Checkpoint

2026-10-19T14:33:37.530Z: local worker Help-history checkpoint, S24 and slices of
A05/A06/A09/A13/A17/A18. Captured-session/exact-version/language envelope,
strict DTOs, bounded five-row paging on both backends and localized directional
controls implemented. Own108-case paging preserves evidence; private notes stay
out. Built first/second/keyboard pages, focus, unsent conversation refresh,
503/malformed recovery, delayed assignment selection and context lock pass.
EN/AR/UR actual320/390/768/1440 fit; separate long mixed-text Help POST/reload
creates one case and no answer. See docs/WORKER_HELP_HISTORY.md and browser JSONs.
Clean57a2adc2-8d30-4829-97c4-708c22b0f687, exec42035 actualexit0: locked offline
install/build,1,222 tests/1,218 passed/zero failed/four native-only skips,
329915.6314ms;43 contract/ten pipeline checks,24 scripted/zero external requests.
All855 source files unchanged, SHA
5c57f663a7c297e919f96dfbde835705f1191f6cf0b053f72d830489ca1e9c65.
Preview UI manifest matches accepted clean. Preservationc114dd1c: original eight
fingerprints unchanged/integrity OK/FK0;42 saved manifests valid,3,722 selected
files/zero configured-secret matches. Original root data/dist unchanged.
Browser59717 exit0:0 business POSTs/nine seeded cases; separate92872 exit0:
1 Help POST/zero answers/ten cases. Tabs closed/viewport reset. All owned checks
terminal, including preservation88534. Premature cleanb76d74fc exec97274 was
stopped after focused SQLite404 mismatch, exit1; retained interrupted.json makes
its old running result state non-authoritative. Initial strip-only TS/fixture
assertion errors and the real HTTP mismatch were corrected before final clean.
Reticle source verification blocked by auto-review due possible external egress;
no diagnostics sent or workaround used. Local browser proof is not Reticle proof.
Overall estimate74% (was73%;uncertainty67-80), S20/S24 Help85% (was80%), service
permissions82% unchanged. Full conversation DTO/captured-read/localized-error,
voice/repeat/resolution, all refs, independent language/AT/phone, native current
permissions, privacy/live-quality and hosted gates remain. Latest user decision:
continue locally for now; no Oracle/payment/account/cloud/provider/mail/billing/
deployment actions. Next local work: CaseConversation read/error and recovery
contracts, followed by remaining worker-facing localization and reference gaps.

User-facing synthetic preview intentionally left running: background PID18452,
port3216, wrapper .tools/start-help-history-preview.mjs;20-minute automatic expiry
after startup. HTTP200 and exact customer-D3HrF3FK asset verified, fresh in-memory
DB only. Open http://127.0.0.1:3216/api/qa-navigation?language=en, then the first
assignment's Help history. This is a temporary UI preview, not a production
server or an outstanding verification process. Recheck actual liveness before
reuse; do not restart a different process or interrupt the user's preview blindly.
The saved original database and old root dist are not used by this preview.

## Previous Identity Checkpoint

2026-10-19T09:32:56.405Z: worker direct identity-write restrictions locally verified.
Migration092 adds four immutable lock guards; worker account memberships are
read-only. Actual separate-role recovery/invitation delivery, API reset/signup,
populated upgrade, schedules/retention and source fencing pass. Clean
b8ad7ba7-38a4-41b3-8800-1be5b67ef396, exec63134 exit0: locked offline install/build,
1,215 tests /1,211 passed /zero failed /four native-only skips,302056.8915ms;
43 contract/ten pipeline checks,24 scripted/zero external requests. All853 source
files unchanged, SHA e838db8a08edcfaa2487f8bf619a28b01d5ba1f39c215d97a21698eeb75dddcc.
Worker policy:87 ordinary-DML, seven column-restricted,34 read-only,nine hidden.
Application/operator grants and original data unchanged; no Neon migrations/ACLs
changed. Historical native91 evidence does not cover the current92 policy.
Preservation22992542: original eight fingerprints unchanged/integrity OK/FK0;
all39 saved manifests valid,3,538 files/zero configured-secret matches.
Built UI shell unchanged from preceding clean. All owned checks terminal.
Identity-write task100% local; broader service permissions82% (was80%);
overall73% unchanged. Credential read minimization, broader permissions,
native/hosted and other release gates remain open. No real-data/provider/mail,
billing or deployment calls. Free-host setup request answered in
docs/FREE_HOST_SETUP.md; Oracle candidate is unprovisioned, card verification,
free capacity/reclamation and no-SLA limits disclosed. No account connection or
public activation authorized. Continue independent local work after checkpoint.

## Previous Checkpoint

2026-10-19T09:16:56.169UTC worker organization/site lock-column boundary locally
verified. Clean6c284a4b-7245-44b5-b023-74c7f08e7975,exec46855 actualexit0:
locked offlineinstall/build,1211tests/1207pass/zero fail/four native-only skips,
321135.2848ms,43contract/10pipeline checks,24scripted/zeroexternal requests.
All851sourcefiles unchanged,SHA
74dec3372dbac06bd0e87a3641f9f033841f598365fe955147c27d95880b1c7e.
Fresh operator startup/HTTP test passed9272.9346ms;earlier rootdist ENOENT
remainsrecorded,notrecastaspass. Exact guard/positive-column admission,
business-write denials,grant/guard drift,real distinct-role preparation/schedule/
retention andexpanded fence pass. API/operator grants,migrations,Neon ACLs and
originaldata unchanged. Worker95write-capable tables now92ordinary DML plus
verification-job columns andtwo immutable lock-column tables;33RO/9hidden.
Preservation57fd5625:original8fingerprints unchanged/integrityOK/FK0,
38savedmanifests valid,3470selectedfiles/zero configured-secretmatches. BuiltUI
manifest identical to6a316e16. No requiredverification process running.
Local lock task100%;broader servicepermissions80% (was75%);overall73% unchanged.
No newnative/cloud/provider/mail/billing/deploy. Native precedingpolicy result
doesnotprove currentcolumnpolicy. Hostedserver availability/setup question asked;
answerpending,notauthorizationtoconnect/deploy andnotablockerforlocalwork.
After30second checkpoint continue broader worker credential/staff lock/write
dependency audit orremaining application/reference work. Goalactive,notcomplete.
See WORKER_LOCK_PERMISSIONS.md andmatchingcheckpointartifact.

2026-10-19 next local candidate:worker organization/site table DML replaced by
SELECT plus UPDATE(id),using the unchanged migration088 immutable lock guard.
Shared exact guard inspection extracted fromoperator checker;positive update-
column checker shared withverification-job boundary. Startup checks actual
table/column/PUBLIC/delegate grants andguard body/trigger identity;restricted
tables receive nosequence access. Fence removes allthree worker column-update
sets. Application/operator grants andmigrations unchanged. No Neon changes.
New focused4tests pass9378.7389ms:10business mutation denials inclunreferenced
IDs,required rowlocks/no-op updates,pause checks,11grant/missing/future/sequence
drifts,threeguard damage/setup refusals andactual distinct-role preparation,
scheduled publication andpopulated text retention withunchangedorg/site rows.
Initial fixtures corrected missing site-control column,explicit preparation
queue andtable-revoke restoration;production checksnotrelaxed. Existing24
permission/authority checks pass25232.8445ms. Larger focusedexec80916 exited1:
71pass/1fail,102050.4193ms;sole ENOENT ispreserved rootdist missing operator
manifest,not a passing hostedstartup. Expanded mixed-role fence1pass2959.204ms
also proves rowlocks denied andlater id-column grant invalidates fence.
TypeScript passes. Full clean6c284a4b-7245-44b5-b023-74c7f08e7975,exec46855
running;install/build passed.851files,SHA
74dec3372dbac06bd0e87a3641f9f033841f598365fe955147c27d95880b1c7e.
Prior6a316e16 remainsaccepted library-only baseline;this candidate needsfinal
regression. Overall73% unchanged. No newcloud approval.

2026-10-19T08:58:44.261UTC worker library restriction locally verified. Clean
6a316e16-71db-4f30-bf19-33ef1afb0a19,exec61661 actualexit0:locked offline
install/build,1207tests/1203pass/zero fail/four native-only skips,312692.2259ms,
43contract/10pipeline checks. Source850files unchanged,SHA
689dc6cdce82e0ebd208a000b2cde5f8947d67859cabe01c7b82c5f6ebdea6ad.
Worker four library tables SELECT-only;API grants unchanged. Populated library
creation/template use,14SQL/domain denials,two real preparation jobs,current
glossary dependency,unchanged library inventory andfour legacy-grant drift cases
pass locally. Prior sandbox de67 failure retained;same snapshot17checks passed
outside isolated network before cleanretry. Preservation70897e61:original8
fingerprints unchanged/integrityOK/FK0,37saved manifests valid,3403selectedfiles/
zero configured-secret matches. Required verification processes all exited.
No cloud/provider/mail/billing/deploy/actual Neon permission change. Narrow local
library restriction100%;broader leastprivilege75%;S23receipt/history85%;overall73%.
Next after30second checkpoint:positive worker organization/site lock-column
boundary with exact existing immutable guard inspection andpopulated worker/fence
tests. Do not remove row-lock privileges blindly. No freshcloud test authorized.
See WORKER_LIBRARY_PERMISSIONS.md;goal remainsactive,notproductioncomplete.

2026-10-19 next local candidate:worker template/glossary libraries become
read-only (templates,template_versions,glossary_terms,glossary_versions).
Application policy unchanged;no migration or actual Neon grant change. New
embedded test uses real application-role library creation/template-derived draft,
then actual worker-role denied writes,glossary dependency/preparation anddrift
reconfiguration. Initial harness failed on expected95-versus94 write-capable
tables (one is column-restricted),then on missing explicit synthetic integration
mode;both corrected without relaxing guards. The glossary edit also queues the
original seeded draft,so the new test now processes exactly both queued drafts
before asserting readiness. Final focusedexec63772 actualexit0:28pass/0fail,
23521.313ms;new isolated test1pass2745.7249ms;TypeScript passes. Sandbox clean
de67c60e-cf2a-4aca-be75-240555d1466f,exec21665 exited1:install/build passed,
1207tests/1070pass/133fail/4skip,321764.413ms. Loopback EACCES plus sandbox
temp-file rename/symlink EPERM andderived session failures;not a passing run.
850sourcefiles,SHA689dc6cdce82e0ebd208a000b2cde5f8947d67859cabe01c7b82c5f6ebdea6ad
remain unchanged. Same-snapshot receipt+permissions tests outside isolated
network sandbox exec11487 exited0:17pass/0fail,18748.0559ms. Full unchanged
retry6a316e16-71db-4f30-bf19-33ef1afb0a19,exec61661 nowrunning withlocal
loopback/temp operations available. Failedrunbreakdown126EACCES/4EPERM/
3derived session errors retained. No cloudcalls oractualgrantchanges.
Preservation0a348001:original8fingerprints unchanged/integrityOK/FK0,
36saved manifests valid/3339selectedfiles/zero secrets. UI shell manifest SHA
b0cced4b6f301e036525dbdddc952ec498c7858a7af3ec5e153256080aee97d1 identical
toaccepted74f4475c;this doesnot convertfailedbackend regression intoa pass.
This candidate isnot yet the verified74f4475c baseline andnot native acceptance.

2026-10-19 S23 receipt/history task85%,overall73%. Same verified850-file build
74f4475c now also passes built history paging/all seven projected states,EN/AR/UR
labels,keyboard Enter,503/malformed clear/recovery,held read/selection removal
andchanged-context lock. Nine receipts/six attempts are explicitly seeded
metadata,not live workflow/quality proof. Fixture14213 actualexit0:allPOSTs0,
13history reads,6list/4detail reads,6seeded attempts unchanged,cases/external0.
Sandbox fixture1113 unreachable then stopped0 with0reads/writes. Historyviewport
control stayed on earlier tab; actual desktop1280 capture isnot mobile proof.
Owned activehistory tab closed/overridesreset;old ownednetwork-error tab cleanup
blocked by URLpolicy,nobypass/user-tabchange. Preservation53b96653 verifies
originaleightfingerprints/integrityOK/FK0,35savedmanifests,3277files/zero secrets.
No requiredverification process running. No newcloud/runapproval consumed.
See WORKER_SUBMISSION_HISTORY.md and WORKER_SUBMISSION_RECEIPT.md.

2026-10-19 S23 exact immediate receipt locally verified. Clean run
74f4475c-897c-4aef-a76f-21914c4a0249 (exec19659, actual exit0) passed locked
offline install/build,1206 tests/1202 pass/zero failures/four native skips,
350733.6369ms,contract and pipeline evaluations. All850 source files unchanged,
SHA87f31d0b5d14e70dab33a6f812ddcc354a76bdeb642a0ec416ffe1583f25d852.
Memory fixture49458 exited0:four explicit typed answer POSTs,four attempts,
zero help/other POSTs,cases or external calls;25 exact receipt reads/13 history
reads. Built browser confirms original answer/server time/version,received versus
pending,actual synthetic assessment to matched without resend,malformed/503 read
clear/recovery,changed-context lock,held-refresh continuity/navigation removal,
direct Help composer focus without POST,and EN/AR/UR320/390/768/1440 fit.
Settled EN/UR740x1600 screenshots saved. Hardware audio,independent language/AT,
all reference states and native/hosted acceptance remain. Overall73% unchanged;
S23 receipt/history task80%. Next:separate nine-row metadata history browser test.
No new cloud mutation approved or performed;earlier native retry already consumed.

2026-10-19 resumed interrupted S23immediate-receipt candidate. Exact request GET
added inbothbackends withserver time,original text/audio,duration/version/language;
newcaptured-session DTOreader andreceived/check stages,directHelp handoff and
visible pending-only10second refresh implemented. Same-exact-data refreshkeeps
playingaudio mounted;failures clearprotectedmetadata. Ownrecording WAVroutes
reuse authenticated verified-byte rangehelper. No migrations/permissions/cloud
changes. Source existsafterinterruption;notyet accepted. Focused tests added;
Focused12tests nowpass2991.046ms:exactDTO/identity/selection,SQLite+embeddedPG
original-vs-later receipt,servermetadata/private fields,deniedreads,withdrawal/
disabledworker andverified private-range reads. Finaltypecheck passes. Memory
fixture adds exact-read faults/counts andopt-in actualsynthetic assessment step;
no externaladapter orcloudcalls. Fullclean/builtbrowser pending. Prior056ee876
isverified history-only baseline,notthiscandidate. Overall73% unchanged.
Clean74f4475c-897c-4aef-a76f-21914c4a0249,exec19659 running;do notrerun until
reconciled. Receiptbrowserfixture starting fromthat exactsnapshot on3215;
no originaldata/cloud/provider/mail/billing/deployment changes authorized.

2026-10-16T12:20:58.282UTC S23history locallyverified (notbrowseraccepted):scoped
submission-history DTO guard,captured-session GET,
15second readtimeout,selection-keyed display andlocalized received/pending/paused/
failed/unavailable/outcome steps. Both HTTP backends echo current clientContext;
existing authorization/native-audio routes unchanged. Eleven focused tests pass
127.3332ms afterfixing unsupported Node strip-only parameter-property syntax.
Finaltypecheck passes. Memory-only fixture gains
opt-in9synthetic historyrows andfixed held/failed/malformed/contextcontrols;
not evidence ofnormal processing oractual recordingplayback. Clean056ee876,
exec99457 terminal0:1201tests/1197pass/zero fail/four native skips,340893.6029ms,
offlineinstall/build,43contract/tenpipeline checks,24scripted/zeroexternalrequests.
All847sourcefiles unchanged,
SHA42dd9e65e3370936877d75583b014b4dcb32705dd756b63fea4704951e5b7abf.
Memory-only fixtureexec75779 starting on3215. Actual focused SQLite+client9pass
524.1822ms andfinaltypecheck pass. Overall73% unchanged;prior verified947bfe0f
remainshistorical baseline. Browserattach failed twice;inventory showsonlyuser
tab3196,noownedtab. Fixture75779 stopped/terminal0 withzeroPOSTs and6seeded
attempts. Directmemory-only PostgreSQL HTTP/reader48518 exited0,8checks pass:
2pages/allstates,failure/malformed/context/heldselection/newselection/staleheader;
zeroPOSTs/unchanged6seededattempts/0externalcalls. Its ownedserverclosed.
Browseracceptance is NOTproved. See WORKER_SUBMISSION_HISTORY.md.
Preservationf532f481:original8fingerprints/integrityOK/FK0,34savedmanifests valid,
3204selectedfiles/zerosecretmatches. No neededverificationprocessrunning.
Historytask75%,overall73%. Next:retry builtbrowser acceptance when attachment
recovers,thencomplete immediate S23/S44 receipt-screen stages/exactrequestbinding.
Selected740x1600 image41(12) inspected:current immediateACK branch lacks itsown
directHelp action anddetailed ownanswer/time/version stages;bottomHelp stillworks.
Implement withactual exactrequest/server metadata,noinventedtimestamp oroutcome.
Independent localwork continues;browserfailure aloneisnotagoalblock.

2026-10-16T12:06:03.394UTC:primary-first S21layout locallyverified. Existing
saved-work tools remainvisible/mounted afterlisten/question/help,beforehistory;
samekeys/props/guards. Playerstarts425px mobile/379px desktop,question639/547px;
EN/AR/UR320/390/768/1440 fit,plusselected821x1600 EN inspected. Explicit synthetic
textsave/reload/restore preserves exactunsentanswer;noPOST. Test snapshotremoved
andsharedmode restored. Sliderfocus8pxgap andArrowRight0.1seconds verified.
Clean947bfe0f,exec4153 terminal0,1196tests/1192pass/zero fail/four native skips,
294630.701ms,offline lockedinstall/build,43contract/tenpipeline checks,
24scripted/zeroexternal requests. All845sourcefiles unchanged,SHA
25d3e9a8540d9704f211464d5aa2d735d2b5df5d02f46865d56405e1c9bebe18.
Fixture1182 terminal0,audioReads8/writes0/attempts0/external0;briefings/publications
unchanged. OwnedQA tabclosed,viewportreset,userpreview notnavigated orrebuilt.
Preservation9cb5251e:original8fingerprints/integrityOK/FK0,33savedmanifests valid,
3135selectedfiles/zerosecretmatches. No required verification process running.
Overall73% unchanged,S21task85%. Fullmatched-reference/native-language/AT/phone/
actualspeech/hosted remain. Next concrete task:S23 truthful receipt/pending/
outcome presentation andcaptured-session/scoped submission-history reads;
inspect existing contracts andaddfocused tests beforechanges. No cloud writes
ornewlive tests authorized. Goalactive;no founder input needed forlocalwork.

2026-10-16T11:57:45.402UTC: S21 playback controls locally verified. Actual native
play/pause,0..12second range,End/ArrowRight seek,Replay reset,rate1.5,body/question
exclusivity,Enter textdisclosure andfailed-read/explicit reload pass. All3UI
languages at actual320/390/768/1440 fit. Authenticated worker speech now supports
single-byte ranges only afterfull existing authority/storage/integrity checks;
no caching orprivate URL bypass. This repairs browser-discovered zero seek range,
not merely a cosmetic control. Earlier failed candidate e48e8105 is preserved.
Clean5b3c6dbb,exec11196 terminal0,1195tests/1191pass/zero fail/four native skips,
294312.5675ms,offline locked install/build,43contract/ten pipeline checks,
24scripted/zeroexternal requests. All844source files unchanged,SHA
cddc523e3a1a7146c754a5ac0f59c2f9642b6af5408b5905898b602671cc78e1.
Fixture24792 terminal0,audioReads12/writes0/attempts0/external0;briefing and
publication inventories unchanged. Owned QA tabs closed,viewport reset.
Preservationaff05c1b:original8fingerprints/integrity/FK unchanged,32savedbuild
manifests valid,3069selectedfiles/zerosecretmatches. See WORKER_PLAYBACK.md.
Overall73% (66-79 uncertainty),S21controls80%. No required process running.
That checkpoint's layoutfollowup is nowcompleted above. Native/cloud/live/hardware/
independent language/AT/full-reference/release gates remain open. No cloud writes
or external calls authorized;native retry authorization consumed.

S20/S24 worker navigation and own-assignment Help hub locally verified.
Briefings/Help/Device navigation, scoped current assignments, existing composer,
draft leave/stay/discard, fresh-detail focus, delayed-read route isolation and
localized failure/refresh pass in the built memory-only fixture. EN/AR/UR fit
actual320/390/768/1440 widths; assignment language remains frozenEN. New help
creates a pending request, not a fabricated staff follow-up conversation.
Fixture70883 exited0 with helpPosts1/answerPosts0/otherPosts0,21list/3detail reads,
onecase/zeroattempts/zeroexternalcalls. Owned tabs closed and viewport reset.
Clean df261e27-44df-441d-a5b5-e1bcb2e3dfb5,exec35339 terminal0:
1190tests/1186pass/zero fail/four native skips,275260.7615ms; locked offline
install/build,43contract/ten pipeline checks,24scripted/zeroexternal requests.
All839source files unchanged,SHA30706687d486e61bd5e839f74c4f2b38ff4e8bf4a47cfe221f07e7eaf4f92f84.
Task80%; overall72% unchanged. Independent language/AT/phone/full-reference and
hosted acceptance remain. No cloud run is active. See docs/WORKER_NAVIGATION_HELP.md.

## Last Verified Checkpoint

2026-10-16 current-policy native three-role retry6a30573b PASSED. Its atomic final
journal reached finished/passed at06:29:36.284UTC (started06:20:56.218UTC):91
migrations,three distinct verified-TLS profiles,20runtime checks/23SQL denials,
seven scripted/zero external provider requests,one concurrent claim/attempt,
revocation/pause/configuration/deadline fences,real5s/30s heartbeat/drain andSQL
heartbeat-fault/persistent startup/recovery. All four exact resources disabled/
removed as applicable;original outside catalog/ACL unchanged. Not network/process
kill,processing-claim expiry,hosted transport,real AI quality or release proof.

After interruption,exec2752 handle was missing;OS check found its exact PID27212
absent. Original exit code was not captured;do not invent exit0. Independent
read-only postcheck at11:12:11UTC exited0:zero exact name/OID databases/roles/
sessions,outside hash stillmatches originala58095ce...65c3. No rerun or writes.
Evidence:`artifacts/neon-three-roles-6a30573b-c52f-46b5-a140-61e1cd8472af.json`
and`artifacts/neon-three-role-postcheck-6a30573b-c52f-46b5-a140-61e1cd8472af.json`.
Authorization consumed;no standing cloud mutation permission. Source stillmatches
clean2c9bdda4 exactly at11:11UTC. No owned verification process remains running.

S19 welcome/language controls now implemented and built-browser checked locally:
native EN/AR/UR radio choices,localized Continue,validated current-session labels,
honest help disclosure,clear/focus masked link entry,explicit cancellation.
No automatic redemption,raw-token persistence or assignment-language change.
All three guest languages fit320/390/740/1440;two premature viewport measurements
were rejected and corrected after settled state. Arabic lost-ack/reload/recheck
reaches Arabic inbox with frozenEN assignment;canceling Urdu leaves Arabic active.
Rejected-before-acceptance Urdu remains unconfirmed across reload/recheck,then
explicit new-link recovery shows empty disabled entry with no invented identity.
Six screenshots saved as `artifacts/worker-entry-s19-*2026-10-16.png`.
Memory-only fixtureexec4414 exited0 via its existing15-minute timer. Actual final
counters:accepted redeem1/logout1/proof3,before redeem1/logout1/proof0;one grant
redeemed,zero active worker sessions,zero attempts/external calls. Port3214 has no
listener after interruption. Browser viewport reset andtemporary tab closed;
no user preview or original data changed.

Clean2c9bdda4-4c58-46c9-968b-3ca55f4b602e,exec37904terminal0,passed
06:10:20.011-06:15:35.670UTC:locked offline install/build,1188tests/1184pass/
zero fail/four native skips,294500.9473ms,43contract/ten pipeline checks,
24scripted/zero external requests. All835source files unchanged,
SHAfab91e260f65e2c6066579147ea5d8e6b377939e77c281b302458c86d9a58720.
Focused entry/recovery/language ten pass12543.7586ms. S19 task80%,loss containment
90%,native rehearsal90%,delegated80%,operator85%,least-privilege75%,native88%,
overall72% (65-78 uncertainty);wider failure/hosted/privacy/device/release gates open.
Preservation8a427c4c at06:25:29UTC:original eight fingerprints unchanged,
integrityOK/FK0,29saved manifests valid,2865files/zero configured-secret matches;
private environments ignored/examples blank or disabled.

## Previous Recovery Checkpoint

2026-10-16: native run2e42b143 FAILED, exec50079 terminal1, unhandled leased
PostgreSQL Client ECONNRESET. Its original journal remains stale/checking and is
not a pass. All91 migrations and three verified-TLS/profile admissions completed;
the full workflow did not. Original OIDs/outside-ACL baseline were lost with the
process. Separate read-only reconciliation captured the four marked resources.
The user then explicitly authorized cleanup of those exact inspected resources.
Cleanup passed at05:46:30.176UTC: database106496 and roles106497/106499/106501
disabled/removed as applicable, absence verified, cleanup-only outside ACL hash
unchanged. Original-run outside invariance remains unverified. See separate
`artifacts/neon-three-role-cleanup-2e42b143-fa5e-4164-b257-9d8697dcd380.json`.
Both native-run and cleanup authorizations are consumed. No cloud rerun is allowed
without fresh approval; no real data/provider/mail/storage/billing/deployment.

Local repair in progress: guarded client leases contain asynchronous socket
errors, reject later queries/false successful acknowledgements, discard broken
or ambiguous-commit connections, and never replay work. All raw PostgreSQL
application acquisitions use this guard, including health/import/restore locks.
The rehearsal persists original nonsecret OIDs/markers/memberships/expiry and
outside baseline before proceeding; atomic synced-file replacement protects the
last complete journal from process interruption. This is not power-loss proof.
Focused37/37, affected38/38 and final lock/lease10/10 passed (overlapping groups).
The first restricted attempt failed only on loopback EACCES/temp rename EPERM;
the same tests passed with local shell permissions. Clean09af7c48-c31b-4820-
8fa9-a9e15a3b9e76, exec48631 terminal0, passed05:58:15.543-06:03:27.885UTC:
offline install/build,1186tests/1182pass/zero fail/four native skips,
294633.643ms,43contract/ten pipeline checks,24scripted/zero external requests.
All833source files unchanged,SHA626e43c77f95c567bf2dfa53e909f3d89f21b5bdf95f435667449367cc037725.
Preservatione1eeede7:original eight fingerprints unchanged,integrityOK/FK0,
28saved manifests valid,2790files/zero configured-secret matches,private envs
ignored/examples blank or disabled. Local loss-containment task90%; native
preparation80%; overall71% unchanged. Native reset/lock/process/hosted acceptance
remains open. Next:S19 welcome/language/reference controls. No frontend edit yet
and no replacement of the user preview.
See docs/POSTGRES_LEASE_RECOVERY.md.

Previous Local Runner Checkpoint (Historical)

2026-10-16 runnable three-role rehearsal: **about71% overall**,goal active,
not production ready. Preparation75% (was55%);delegated75%,operator80%,
service-role70%,crews85% unchanged. A distinct exact three-login CLI now selects
the default current91-policy exercise and v2 evidence,not an injected pass stub.
It adds pause/rotation/expired-queued-approval/guard-drift checks,normal five-second
heartbeat through two18s requests and5.5s drain,SQL-rejected heartbeat,blocked
second dispatch/late result,persistent startup rejection and recovered presence.
Cleanup checks owned-role sessions across all databases and refuses every DROP
on ambiguity. Lost role CREATE/COMMIT acknowledgement and lingering-session
fixtures pass. No unrelated connection is terminated. The temporary SQL fault
function gets only a disposable worker EXECUTE grant and is removed afterward;
the initial fixture failure at permission admission is retained as failed history.
Focused23pass55766.771ms preceded CLI changes;final CLI/ack/session five pass
323.1661ms. Final clean d6b611b6-75cf-4e9d-818e-2b9542be2823,88363terminal0,
05:22:16.741-05:30:36.945UTC:locked offline install/build,1173tests/1169pass/
zero fail/four native skips,477038.5534ms,43contract/ten pipeline checks,
24scripted/zero external requests. All832source files unchanged,SHA256
1e6b589537f97ec46a0a46322443de091c7f0c0f7c54d6105678a507f907d030.
Preservation e7b2fb18-838e-4032-bff8-7d49e07d0fe8:original eight fingerprints
match prior checkpoint,integrityOK/FK0,27saved manifests valid,2722selected files/
zero configured-secret matches;private envs ignored/examples blank or disabled.
Fresh bounded Neon authorization requested and pending;no cloud/provider/mail/
realdata/billing/deployment changes. NativeTLS/concurrency,processing-claim
expiry,network/lock/process failure,hosted and release gates remain open.
See docs/NATIVE_THREE_ROLE_PREPARATION.md and
artifacts/production-three-role-runner-checkpoint-2026-10-16.json.

Previous three-role orchestration preparation:

2026-10-16 three-role rehearsal preparation: **about 71% overall**, goal active,
not production ready. New preparation task55%; delegated75%,operator80%,
service-role70%,crews85% unchanged. Explicit separately confirmed orchestration
accounts for three expiring logins,exact outside exclusions and eight target DB
connections. Cleanup independently disables provably owned roles and refuses
deletion on any marker/OID uncertainty. The CLI remains unavailable for three
roles; prior cloud authorizations are not reused.
The embedded current91-policy exercise now covers all three distinct profiles,
API publication/worker assessment,keyless operator enqueue/original receipts,
competing calls/one claim,revocation,no replay/refund,positive-column denials,
disposable grant drift/restoration and all-role fence with unchanged inventory.
Serialized PGlite is not native concurrency/TLS/hosted evidence. Focused20tests
pass,6707.1649ms. Final clean140abc11-005b-404e-8fc4-320e156225a3 passes,
05:05:04.275-05:09:47.270UTC:locked offline install/build,1170tests/1166pass/
zero fail/four native skips,265812.0237ms,43contract/ten pipeline checks,
24scripted/zero external requests. All831source files unchanged,SHA256
51c99ea3399e4820ae1e4d25be5b45186e7ab300d486676ad2d018863c116cf4.
No cloud resource,provider/mail,real data,billing or deployment changed.
Preservation d31cb22b-2192-402b-bc82-49bc154f980a:original eight fingerprints
match f930c49a,integrityOK/FK0,26saved manifests valid,2654selected files/zero
configured-secret matches;private envs ignored and examples blank/disabled.
Next:finish native-ready failure matrices and distinct CLI/evidence before
requesting fresh bounded three-role authorization. See
docs/NATIVE_THREE_ROLE_PREPARATION.md and matching checkpoint artifact.

Previous independent-heartbeat checkpoint:

2026-10-16 independent worker heartbeat: **about 71% overall**, goal active,
not production ready. Delegated verification **75%** (was 70%); operator isolation
80%, service-role 70%, crews 85% unchanged. Health/capability now commit together
every five seconds while stages await. Writes are serialized; stop drains them
before a fresh terminal snapshot. Heartbeat failure blocks later dispatch/result
promotion and remains visible even when discovered during shutdown. Stage errors
are retained until acknowledged by a successful publication. No new SQL grants
or migration: still 137 tables / 91 migrations.
Final clean 650e1447-8227-4a07-9b29-54209ad479a9 passed, 04:49:42-04:54:45 UTC:
locked offline install/build, 1163 tests / 1159 passed / zero failed / four native
skips, 286103.1967ms; 43 contract and ten pipeline checks, 24 scripted requests,
zero external requests. 831 source files unchanged, SHA256
c9626532c20210f2d8dd892f8b434eac5f3aad7b8f6bbcd7ebab3c338340774c.
Completed journal and exited/absent verifier handle revalidated after context
transition. The real default-cadence synthetic test holds two requests 18 seconds
each across the real 30-second freshness window. Native multi-connection and
stalled-database/platform-stop behavior are not proven by PGlite.
Preservation 968ccd2d-b15b-45b2-a6f0-a8b7ab2abfb8: original eight fingerprints
match f930c49a, integrity OK/FK0, 25 saved build manifests valid, 2588 selected
files/zero configured-secret matches; private envs ignored/examples blank and
worker verification disabled. No original DB/preview, cloud resources, provider,
mail, real data, billing or deployment changed. See docs/WORKER_HEARTBEAT.md and
artifacts/production-worker-heartbeat-checkpoint-2026-10-16.json.
Native three-role work is still preparation only, not a runnable/authorized
cloud mode; docs/NATIVE_THREE_ROLE_PREPARATION.md records the remaining contract.

Previous capability/keyless operator bridge checkpoint:

2026-10-16 capability/keyless operator bridge: **about71% overall**, goal active,
not production ready. Delegated verification70% (was45%); operator isolation80%
(was75%); service-role70%,crews85% unchanged. Migration091 adds worker-only hash
registrations with DB-stamped observations,immutable metadata and terminal stop.
Fresh compatible workers with one configuration permit new tests;stale/stopped/
missing/incompatible/conflicting observations block them. The dedicated operator
holds no provider adapter/key, binds new commands to the reviewed configuration,
and recovers original receipts without automatic POST replay. Browser command
recovery persists and validates the fingerprint; stale success messages clear.
Staging worker fixed synthetic tests are default-off/explicit opt-in;ordinary
content/provider paths stay off and real-worker content remains prohibited.
Normal heartbeat is still stage-boundary/throttled,not independent through long
awaited stages;bounded liveness/native91/concurrency/hosted/live gates remain.
Catalog137/91migrations:application118DML/12read-only/7hidden;worker98full-DML plus
one limited-column job table/29read-only/9hidden;operator19some-write/19read-only/
99hidden. Seven invoker functions/nine guards are inspected.49focused checks and
two hosted-config checks pass. Initial e5a1ff9f full passed1153tests1149pass/four
native skips/zero fail plus build/evaluations;after interruption,completed report
and missing handles/process/listener revalidated. Only Operations.tsx changed
after that snapshot to clear the prior command's success message.
Final bfbca555-7889-49cc-bb77-291d1865bd77,30114terminal0,04:23:06-04:28:16UTC:
locked offline install,production build,1153tests1149pass/zero fail/four native
skips,289429.0564ms,43contract/ten pipeline checks,24scripted/zero external calls.
829source files unchanged,SHA256
331417d904eb627c72ea9b4b8cdc22c94e4192548e6f9b2f119fdac955de735e.
Final built mock browser loss/outage/reload/completion/stopped-worker and320/1440
checks pass:one test POST,one slot,one mock call,four receipt GETs,zero customer
APIs. Keyboard login/receipt/logout observed;no full keyboard/AT or hostedTLS claim.
Reticle had no connected browser/no verdict;no diagnostic uploaded. Owned tab
closed/viewport reset;fixture62395 interrupted,exact child/launcher and3196
listener absent. No graceful fixture-shutdown claim. No original DB/preview,
existing cloud role/storage,provider/mail,real data,billing or deployment changed.
Preservation1f953f5c-1bc5-41b1-8395-23e77771589b:original eight fingerprints
match prior f930c49a,integrityOK/FK0,24saved build manifests valid,2518selected
files/zero configured-secret matches. Private envs ignored,both example Gemini
keys blank;worker verification example stays disabled. Durable record:
artifacts/production-verification-capabilities-checkpoint-2026-10-16.json.
See docs/VERIFICATION_WORKER_CAPABILITIES.md for exact limits and next work.

Previous durable queue checkpoint:

2026-10-15 durable provider-verification queue: **about71% overall**, goal active,
not production ready. Delegated verification45% (was20%); operator75%,
service-role70%,crews85% unchanged. Migration090 now connects atomic operator
enqueue/quota/authority/audit, immutable fixed request metadata, one-claim worker
execution, exact accepted request metering and original receipt reconciliation.
Operators have no result-update/claim-token grant; workers get only seven job
UPDATE columns and no operator sessions/identity access. Terminal jobs cannot
reopen. Interrupted claims are sealed uncertain with no automatic provider replay
or quota refund. The scheduler registers the stage only outside application-
profile legacy runtimes; actual application job-table denial remains enforced.
Local shutdown drains one claimed test and stops before the next stage.
Catalog136/90migrations:application118DML/12read-only/6hidden;
worker97DML plus one limited-column job table/29read-only/9hidden;
operator19some-write/18read-only/99hidden. Six invoker guard functions/eight
trigger bindings and exact worker job-column grants are verified at admission.
Final focused33pass/zero fail/zero skip,26503.7446ms,57467terminal0.
First full7fa49ae1-8127-447b-8a9d-e4f3c5e68830 retained as failed:1145total/
1140pass/one application-role scheduler mismatch/four native skips,
270184.7569ms. Only runtime.mjs and provider-verification-jobs.test.mjs changed
after that snapshot; no database permission or original assertion was weakened.
Corrected-source full7ba8b703-a873-4e24-bc6d-93d52f40f924 passed,93968terminal0,
20:06:05-20:10:55UTC:locked offline install,production build,1146tests/1142pass/
zero fail/four native-prerequisite skips,270364.0603ms,both synthetic evaluations.
827source files unchanged,SHA256
d44af148fea46ec1de4b19dfd86d1cb3235b9b5d2524fbb6605f9273c3ffb50a.
Worker capability freshness/keyless operator HTTP/built queue UI/native90 and
hosted/live acceptance remain open. Hosted Gemini still disabled, no real worker
content/cloud resources/ACLs/storage/provider/mail/billing/deployment changed.
Both evaluations passed43contract/ten pipeline checks with24scripted and zero
external requests. Existing mixed static/dynamic-import build warnings remain.
Preservation88f5f6d0-229d-4958-a4d5-1dcc69f426cf:original eight fingerprints
match f930c49a,integrityOK/FK0,22saved build manifests valid,2384selected files/
zero configured-secret matches;private envs ignored/example Gemini key blank.
See docs/DELEGATED_PROVIDER_VERIFICATION.md and durable
artifacts/production-verification-queue-checkpoint-2026-10-15.json.

Previous authorization-only checkpoint:

2026-10-15 provider-worker authorization foundation: **about71% overall**,goal
active,not production ready. Worker-dispatched verification20%;operator75%,
service-role70%,crews85% unchanged. Migration089/source/disposable only adds
three-field worker-readable authorization,invoker capture/revocation hooks and
exact runtime function/trigger admission. Customer role cannot access it;
worker cannot insert/extend/revoke/reopen it. Per-request inline metering now
also checks this authority. Actual delegated queue/worker execution is not built
or enabled yet. Backfill preserves old verification rows while closing expired,
missing,revoked,inactive/completed and mismatched approvals;UUID1-5 preserved.
Catalog135:application118DML/12read-only/5hidden,worker97/29/9,operator16some-write/
20read-only/99hidden. Final four-file34pass/zero fail/zero skip,22982.2422ms.
Earlier root-build focused run27pass/one ENOENT operator-manifest failure retained;
original dist not replaced. Superseded bbcf3ff4/ec590f05 clean runs intentionally
stopped for mismatch/UUID fixes,not credited. Final a88a3875-1faf-4f71-a830-1dbaa8be9534,
9682terminal1,19:27:36UTC:1130tests/1124pass/two fail/four native skips,
258538.5942ms. Both failures were exact historical migration arrays ending88.
Appended89 without removing any history/privacy assertions;both upgrade tests
now pass,2061.869ms. Current source differs only in those two test files from
the tested application snapshot.821source files,currentSHA256
a560b5b71361192cba7feca735eb847c098d99895350cf9dfe11c1a3127b8fe2;
baselineSHA256dec1b128fe5f646d1e37464a0103949b785f2ea4e9df632f7d61c75d4ca6fe29.
Separate stripped-environment contract/pipeline evaluations pass at19:30:13UTC;
original failed journal retained. No claim of an unchanged full verifier pass
after the two expectation corrections. No application code changed after it.
No original SQLite/preview,cloud roles/data/storage,provider/mail/billing or
deployment changed. See docs/DELEGATED_PROVIDER_VERIFICATION.md.
Final preservation f930c49a-efbe-4e6c-96b2-faaeb67468aa:original eight hashes
match prior checkpoint,integrityOK/FK0,20build manifests valid,2252selected files/
zero configured-secret matches. Durable record:
artifacts/production-verification-authority-checkpoint-2026-10-15.json.

Previous operator-entry checkpoint:

2026-10-15 standalone operator entry: **about71% overall**,goal active,not
production ready. Operator isolation75% (was70%);service-role70%,crews85% unchanged.
Separate optimized frontend opens operator login at /,without customer bootstrap
or PWA registration. Manifest graph limits served assets;customer JS/PWA return404,
HTMLno-store,worker-src none,microphone/camera/geolocation denied. Hosted startup
requires the new operator build and existing verified ACL/origin/cookie boundary.
Focused13pass/zero skips. Fresh run0dbcbc34-02dd-4eb9-b49b-6bc76d6960e2 offline
install/build and1118tests1114pass/four native skips/zero fail,263129.361ms;
43contractchecks pass. Continuation stopped verifier/child during pipeline.
Original running journal retained;separate resumption at19:01:36UTC passes ten
pipeline checks with zero external requests. Before/after818file comparisons
match SHA256436b45941de6eca40be774a2a9d58e687ff7eda324a556ee222e3fb07a99b9d2.
This is composite unchanged-source evidence,not an uninterrupted verifier pass.
Real local operator root/login/reload/logout and320/1440rendering observed;
zero customer API calls. FourSWGETs included one explicit probe,all path404;
unsolicited origin/browser cause unestablished,no prior-worker-clearance claim.
Fixture process/port absent after continuation,owned tab closed,viewport reset;
no graceful-shutdown claim. Preservation b3157a8b-b040-4008-b00b-2e480551caaa:
original eight fingerprints/integrity/FK unchanged,17manifests valid (16x55/new56),
2061selected files/zero secret matches. No external cloud/AI/mail/realdata/billing/
deployment. See docs/OPERATOR_ENTRY.md and matching checkpoint artifact.

Previous crew checkpoint:

2026-10-15 17:56UTC crew browser checkpoint: **about71% overall**,goal active,
not production ready. S27crew acceptance85% (was75%). Fixed desktop table word
wrapping,mobile contact width/44px targets,forward arrows and Arabic comma.
Built synthetic create/move/rename/archive/restore/keyboard-paging and EN/AR
journeys observed;current membership18to17 while frozen assigned18 and header
30/24/21/3/6 stay unchanged. Widths320/390/768/1440/1586 have no page overflow;
390layout measured only. Screenshots saved;independent Arabic/AT/matched-reference/
delayed-authority/native acceptance remains open. Contact settings destination
is still English,part of existing localization backlog. Owned fixture stopped,
QA tab closed/viewport reset,OSzero listeners3192/3193;original previews retained.
Fresh clean0dc72f84-7c89-4cd7-8a76-ef61fc51ce17 terminal0,17:51:21-17:56:42UTC:
offline install/build,1115tests/1111pass/zero fail/four native-prerequisite skips,
279548.5331ms;43mocked contract/ten scripted pipeline checks pass.814source files
unchanged,SHA256 c2d2893909fb04e4b18ff6bca4e6ed0627b7e4001c12fa984bd8e43b3efd2538.
See artifacts/production-site-crews-browser-checkpoint-2026-10-15.json and
docs/SITE_CREWS_OVERVIEW.md. No cloud/realdata/AI/mail/billing/deployment.
Preservation f37ea774-7523-443f-b8b7-100a305afae2:original eight fingerprints
match prior checkpoints,integrityOK/FK0,sixteen55-file shell manifests match,
1987selected files/zero configured-secret matches;private envs ignored.

Previous control-plane checkpoint:

2026-10-15 control-plane/actual API-role checkpoint: **about71% overall**,
goal active,productionReady false. Service-role estimate70% (was65%);narrow
control-plane acceptance85%,operator isolation70% unchanged. Application control
tables now read-only and operator audit hidden from API/worker. Catalog134:
application118writable/12read-only/4hidden,worker97/28/9,operator15/20/99.
All ten scripted customer stages now use actual application ACLs;15worker tasks
restore their application caller. Four named maintenance setup/control actions,
no owner fallback for customer work. Distinct-role customer retry reads original
operator history but cannot forge receipts or unpause jobs. No new migration.
Focused57tests and final47tests pass. First full493d367d-40ca-4b44-9ddb-536f28fb77d0,
80106terminal1:1115total/1110pass/one failed/four skips,271830.7802ms. UNKNOWN
Windows file-open error on copied016 migration,not a domain assertion. Original/
copy SHA256match;unchanged same-snapshot15restore tests pass,73965.9913ms,
27941terminal0. Cause not established;failed full run remains uncredited.
Fresh full rerun d95947b4-ac0d-41d1-8ac8-b93ef550bb22 passed,13:40:40-13:45:24UTC:
1115total/1111pass/zero failures/four native-prerequisite skips,265936.7204ms;
43mocked contract/ten scripted pipeline checks pass.814source files unchanged,
SHA256 b97eeaf7bd25f7ee563e1920da18320ae9e5161ac9ce170df4e0cb1055a3c752.
No changed assertions or file-read retries to hide the earlier failure.
Browser recovered. Fresh built in-memory fixture3192/3193 observed S27 member
paging/selection and EN-to-AR/RTL;confirmed desktop table/contact-mobile wrapping
defects remain,next UI work. Screenshots saved,not full reference acceptance.
Owned QA tab closed/viewport reset,64194terminal interrupt,OSzero listeners.
Other tabs and original previews/data/build retained. No cloud/realdata/AI/mail/
billing/deployment or existing ACL changes. See docs/CONTROL_PLANE_RUNTIME.md.

Previous2026-10-15 dedicated operator column/runtime checkpoint: **about71% overall**,
goal active,productionReady false. Service-role hardening65% (was58%);dedicated
operator isolation70% (was30%). Positive explicit operator column/verb ACLs,
separate bounded login budget,guarded no-change locks/revocation/failed retries,
generated export eligibility without snapshot SELECT,and actual restricted
startup implemented. Source fence binds all three service profiles and removes
operator column writes. Application124writable/seven read-only/three hidden;
worker98/28/eight;operator15/20/99 of134 tables (three operator writes lock-only).
New migration088 applied only in disposable embedded fixtures,not cloud/original
data. New operator service refuses private storage/AI/mail credentials,customer
APIs and wrong/owner database roles. No live provider tests enabled.
Expanded13-file63tests pass,39729.6974ms,71617terminal0;guard/startup8tests pass,
13922.606ms,90996terminal0. Full clean baseline6f06f347-36b3-4719-8cb2-1240d514b0dc,
76154terminal0,13:02:58-13:08:36UTC:offline locked install/build,1114tests/1110
pass/zero fail/four native-prerequisite skips,316713.2048ms;both evaluations pass,
814stable baseline source files,SHA9aae5ca18bd6bb4adaf529a63071b709e5a89b711e85e935f0733c97e4fd165d.
Final review then reproduced a real SQL-literal CR normalization drift defect
(targeted one-test failure). Fixed to normalize CRLF pairs only. Final focused
five-file28tests pass,15837.1163ms,88385terminal0. Only operator-permissions.mjs
and its regression test differ from the full baseline;current814-file SHA
0519df7b688487b948c005f468f30ad307a0d04b6a871874c78aa3198a9e986b.
Do not describe the earlier full baseline as an unchanged final source snapshot.
No public deployment,cloud role/DB/ACL changes,realdata,AI/mail,billing,original
preview restart,original SQLite migration or build replacement. Native88/three
verified-TLS logins,operator default entry/browser/proxy/deployment,provider-test
delegation and finer application/worker privileges remain open. Next local work:
remove remaining customer/worker control-plane authority after dependency audit,
then prepare a bounded native three-role test. No user input needed yet.
See docs/OPERATOR_COLUMN_PROFILE.md and the current progress board. Durable
evidence:artifacts/production-operator-column-checkpoint-2026-10-15.json.
Preservation13:14UTC,5ba190fb-6499-4815-a6d9-700b3e2ace86:original eight table
hashes/integrity/FKs unchanged;thirteen55-file shell manifests match,
1798selected files/zero configured credential matches,private envs ignored.
All needed owned test/verifier handles terminal;no actual hosted/native/cloud
change,external diagnostic workaround or browser screenshot. Final diff passes.

Previous2026-10-15 operator HTTP/credential boundary: **about71% overall**,goal active,
productionReady false. Service-role hardening58% (was55%);dedicated operator
isolation30%. Hosted customer/worker configuration refuses operations access;
internal separate-origin operator HTTP boundary has host-only Secure cookie,
no customer APIs or storage/AI/mail credentials. Application SQL profile now
124writable/seven read-only/two hidden operator identity/session tables;worker
unchanged98/28/seven. New denials and grant-drift checks pass embedded SQL.
Expanded11-file61tests pass,zero fail/skips,31956.3609ms,48136terminal0.
Earlier13-test attempt12pass/one ECONNRESET from missing test-body framing;
fixed Content-Length without dropping invalid-body/no-database assertions.
Public operator launcher deliberately NOT added:positive operator DB profile,
restricted retry/control grants,native new-policy and deployed/browser isolation
remain open. Existing application roles retaining old operator grants fail
startup pending explicit stopped-writer maintenance reconfiguration;no live ACLs
changed. Fresh clean b1ec0c63-9c02-45fb-b931-e54c4ba74962,57142terminal0,
12:33:24-12:39:03UTC:offline locked install/build,1106tests/1102pass/zero fail/
four native-prerequisite skips,314999.3123ms;43mocked contract/ten scripted
pipeline checks pass.811source hashes stable,SHA
812b8f508b9adfa3dfa801d9cc7cd0b0f5fa0b8d7b3727f02b343276d156f5b9.
Preservation b9fa842c-a38a-46a5-917c-efb62aff7b96:original eight table hashes
unchanged,integrityOK/FK0,twelve55-file shell manifests match,1726selected
files/zero configured credential matches,private envs ignored. All needed owned
sessions terminal;no browser/reference,live AI,native new-policy or CI proof added.
No cloud/realdata/mail/billing/deploy or original preview/build/database changes.
See docs/OPERATOR_SERVICE_BOUNDARY.md. Current new code is not certified by the
older full-suite result below. Progress board's stale62% weighting table was
reconciled with the existing70.65% basis;that correction adds no progress credit.

Final12:40UTC preservation8208388f-1313-40bf-b55a-e9916a08a938 confirms the
same original eight hashes/integrity/FKs and twelve55-file manifests;1731selected
files/zero configured credential matches. Final diff check passes. Next local
task:positive operator metadata/verb/column profile and constrained retry/control
authority,then a directly verified dedicated launcher. No user input needed yet.

### Earlier Team-First Checkpoint (Historical)

2026-10-15 12:12UTC: **about71% overall**,goal active,productionReady false.
Team-first S27 source implemented at#people/crews:dual-backend scoped read model,
frozen-publication crew metrics distinct from current members,configured site
contacts,bounded activity and selection/member paging. Reuses existing worker/
crew create/membership forms and crew rename/archive/restore;no new permissions
or migration. Strict client DTO/denominator/scope guards;25focused tests and
typecheck/separate ignored build pass. Legacy missing snapshot is unavailable,
not zero or GET-time backfill. First smoke/fixture failures recorded in
docs/SITE_CREWS_OVERVIEW.md;final focused25pass,zero skips.
Visual/browser acceptance NOT run:Windows process-security launcher fails for
both restricted shell and Cua,HRESULT0x80070020;one supported kernel reset also
failed. No raw-browser or external-diagnostic workaround. Approved local shell
fallback runs source/type/backend tests. Fixture31530 on3190/3191 stopped,
terminal interrupt;OS confirms zero listeners3190/3191. Do not reuse previous
Arabic-directory screenshots as new team-first evidence. Fresh clean
a7f72d68-e42e-41b9-a420-377d2265983c,78081terminal0,12:04:23-12:10:14UTC:
locked offline install/build,1101tests/1097pass/zero fail/four native-prerequisite
skips,327018.7588ms;43mocked contract/ten scripted pipeline checks,809stable
source hashes,cloud config/original data excluded. All needed owned sessions
terminal. Original eight table hashes match,integrityOK/FK0;eleven55-file shell
manifests match,1660selected files/zero current credential matches,private envs
ignored. Preservation abdad6ff-ddb0-484e-9065-b8ebefb1211d. Original previews not
restarted or newly liveness-certified;rootdist not replaced. Native/cloud/realdata/
mail/billing/deploy not enabled. Team-first S27acceptance75%,localization57%;
broader percentages unchanged pending actual new acceptance. Durable evidence:
artifacts/production-site-crews-checkpoint-2026-10-15.json. Browser/runtime
recovery and rendered acceptance remain open;independent local work may continue.
Final12:15UTC check:all809current source files equal the passing snapshot;
original eight table hashes and eleven shell manifests still match,
1662selected files/zero current credential matches. Evidence
3e411f27-49c5-418c-9144-082ae99aa69a. No new current-view screenshot is available.

### Earlier Arabic Directory Checkpoint (Historical)

2026-10-15 08:06UTC: **about71% overall** (64-77% uncertainty),goal active,
productionReady false. Arabic presentation of existing directory/crew workflows
implemented and locally verified. Localization57%;broader Arabic-directory/S27
acceptance85%,not full S27 reference completion. New106 directory/17 shell
English-Arabic message pairs,RTL right-side desktop sidebar/site selector/date/
search/session-lock override,worker/crew forms,confirmation and membership moves.
Locale changes retain open edits and do not change authority or worker language.
Private-link/deletion/assignment-history subpanels explicitly remain English;
unrelated routes stay English. App-instance preference is not durable on reload.
Built synthetic create/rename/move/archive/restore/reload,error translation,
unsent-language switching,keyboard confirmation/Escape and320/390/768/1440 checks
pass without page overflow;320px dialogs281wide. Reticle possible-egress check
blocked by auto-review,no bypass/diagnostics. IAB QA tab closed,viewport reset,
owned fixture stopped;OS confirms zero listeners3188/3189.
Focused28tests pass;initial restricted HTTP attempt hit EACCES,not a code failure.
Fresh clean9cc91df8-999e-4431-86fe-d34119843f01,62109terminal0:locked offline
install/build,1092tests/1088pass/zero fail/four native-prerequisite skips,
253632.3536ms;43mocked contract/ten scripted pipeline checks,802stable source
hashes. No live-accuracy or actual CI/native cloud/deployment claim.
Original eight table hashes match,integrityOK/FK0;nine55-file shell manifests
match,1531selected files/zero current credential matches,private envs ignored.
No cloud/realdata/mail/billing,original preview restart/build replacement or
existing database migration. Weighted combined refs/language/device category
53to54 yields70.65 before rounding;overall remains71. Other domain estimates
unchanged. Team-first S27 composition/remaining controls,independent language/
AT/device,external erasure/restore,combined native cloud/private backup/cutoff,
fine-grained/operator separation,live quality and authorized hosted release open.
See docs/STAFF_DIRECTORY_ARABIC.md and
artifacts/production-arabic-directory-checkpoint-2026-10-15.json.
Post-checkpoint preservation08:09UTC:4a99e03b-576d-423d-b783-25098b82b8d9,
1533selected files/zero current credential matches;original data/builds unchanged.

### Earlier Cleanup-Scope Checkpoint (Historical)

2026-10-15 07:39UTC: **about71% overall** (64-77% uncertainty),goal active,
productionReady false. Current-application cleanup-scope API/UI task complete;
broader application/provider/history/backup erasure accounting25%. Both backends
project application_current_view and four not_verified external categories in
directory/detail/initial/duplicate acknowledgements;strict browser guards reject
missing/malformed scope or unsupported verified claims. Existing IDs,timestamps,
redaction/pseudonym/completion/audit journals preserved;no migration or cleanup
side effect added. UI and retention copy avoid universal permanent-erasure claims.
Focused15tests pass. Built1440/320 queued/completed status and dialog focus trap/
Escape checks pass;zero deletionPOSTs,two pre-created fixture requests,target
untouched. Reticle disconnected before a substantive verdict,not counted as a
pass;lease released/session yielded,no diagnostics sent. IAB QA tab closed and
viewport reset;owned3186/3187 fixture stopped,ports absent on resume. Original
preview services were not restarted or newly liveness-certified.
Final fresh clean40c75c5e-8e6b-468a-831d-d3cb4bdced31,66974terminal0:
locked offline install/build,1086tests/1082pass/zero fail/four prerequisite skips,
256062.8081ms;43mocked contract/ten scripted pipeline checks,800stable source
hashes,cloud config/original data excluded. Prior4deefb4c-5094-460b-8bc5-
875a507d6424 failed one old exact DTO expectation,now updated to assert every
new field. Prior5ca8c673-e3ac-481f-a83d-ffca8ca0f3f8 interrupted,not a pass;
missing handle and OS inspection confirmed no verifier/tests before restart.
All required owned test sessions terminal. Original eight table hashes match,
integrityOK/FK0;seven55-file shell manifests match;1403selected files/zero
current credential matches,private env files ignored. No cloud calls,realdata,
mail,billing,existing DB migration,original build replacement or deployment.
Storage55%,native82%,service-role55%,backup75%,hosted20%,release40% unchanged.
See docs/DELETION_CLEANUP_SCOPE.md and docs/NEON_STORAGE_PRIVACY_GATE.md.
Durable checkpoint: artifacts/production-cleanup-scope-checkpoint-2026-10-15.json.
Post-checkpoint preservation at07:45UTC:1ae65a8e-574d-49d8-9efe-e5fd75578784,
1409selected files/zero current credential matches;original data/builds unchanged.
At that checkpoint,read-only inspection confirmed S27 staff site/crew Arabic RTL remained open:
People.tsx management controls are English-only and main.tsx has no general
staff locale mechanism. Worker language selection is a separate implemented path.
Next broad work:independently verified external disposition and restore/backup
accounting,combined native cloud storage/private backup/custody/cutoff,
operator/column separation,complete staff/worker language/reference/a11y/device/
live quality acceptance,actual CI and hosted release. No final-erasure claim.

### Earlier Six-Family Checkpoint (Historical)

2026-10-15 07:02UTC: **about71% overall** (64-77% uncertainty),goal active,
productionReady false. Private storage55%,service-role55%,nativePG82%,backup75%,
hosted20%,fresh-setup/release40%. Explicitly approved six-family cloud application
test18166terminal0:artifacts/neon-application-storage-8eaa619c-eada-4fda-88be-
231719897356.json,06:53:58-06:55:11UTC. Ten normal backend workflow checks,
nine fixed synthetic tone objects/288396bytes,all authenticated readback/
anonymous denial/conditional PUT412/unchanged-byte checks pass. All exact
ownership-marked objects removed from current branch; final listing empty.
Database remains PGlite and providers scripted;not native DB+storage together,
browser/device or deployed acceptance. No cloud DB writes,external AI/mail,
realdata,billing,configuration switch or public deployment. Original preview/
DB not restarted,migrated or switched. Final source uses `checking` for initial
runner journals;the live pass predates only that observational label/assertion
fix. Earlier failures remain failures:journal fault handling was corrected;
restricted config-import EPERM passed the approved unchanged rerun.
Local34focused and final runner10focused pass; local pipeline ten checks/nine
objects/15worker tasks/24scripted requests pass. Fresh clean snapshot
99f90eb2-717a-4e05-ba7a-14af3522d0bc,35518terminal0:locked offline install/build,
1084tests/1080pass/zero fail/four prerequisite skips,263373.657ms;43mocked
contract and ten scripted pipeline checks;798source hashes stable. No inherited
cloud configuration or original data copied. Privacy investigation confirms
current404 is not storage-history/final-erasure evidence;provider lifecycle/
branch/backup disposition and truthful completion scope remain a release gate.
Hosted runtime still rejects non-synthetic staging. See
docs/NEON_APPLICATION_STORAGE_REHEARSAL.md,docs/NEON_STORAGE_PRIVACY_GATE.md,
docs/PROGRESS_BOARD.md and docs/PROGRESS_REASSESSMENT_2026-10-14.md.
Next:application cleanup versus provider/history/backup completion accounting,
combined native cloud-storage/private backup/custody/cutoff,and remaining
operator/column privileges,reference/languages/a11y/devices/live quality/release.
Preservation07:02:52UTC:original eight table fingerprints unchanged from prior
checkpoint,integrityOK/FK0;five55-file shell manifests match;1276selected files/
zero current credential matches,private env files ignored. All needed owned
test sessions terminal. Checkpoint:
artifacts/production-six-family-storage-checkpoint-2026-10-15.json;
preservation:artifacts/clean-backup-preservation-1b8330a0-4cce-49f4-ab6d-
93b7b7df6908.json.

### Earlier Service-Role Checkpoint (Historical)

2026-10-15 06:42UTC: **about70% overall** (63-76% uncertainty),goal active,
productionReady false. Service-role hardening55%,nativePG82%,private storage40%,
backup75%,hosted20%,fresh-setup/release40%. Actual authorized Neon test passed:
87migrations,separate API/worker direct verified-TLS logins,wrong-profile startup
rejection,API publication/submission,worker scheduled assessment,13 SQL denials
and durable mixed-role fence with unchanged full business inventory. One exact
temporary database and both expiring logins removed;outside catalog/ACL/roles/
memberships unchanged. Evidence:artifacts/neon-service-roles-1ee4833f-f3bb-4e52-
a40b-db7e1d64d010.json,36070terminal0,06:35:03-06:40:12UTC.
Worker policy retains98writable/28read-only/7hidden tables; broad DML remains,
so finer verb/column limits and operator-service separation are not complete.
Populated worker/mail/hosted/pipeline35focused tests and runner/permission24
focused tests pass. Fixed scripted pipeline runs15 tasks as the worker identity,
24scripted requests/zero external;API remains an owner fixture in that evaluation.
Fresh clean snapshot747d3395-92dc-4e8e-a66b-d2ae0a9c1a1e,15513terminal0:
locked offline install/build/full1074tests,1070pass/zero fail/four prerequisite
skips,228510.7486ms;43mocked contract/nine scripted pipeline checks pass;
795selected source hashes unchanged. Initial restricted focused attempt failed
loopbackEACCES;approved rerun passed unchanged. No realdata,provider/mail calls,
storage writes,billing changes,public deployment,existingDB migration or preview
restart. Original eight business tables match the06:22 checkpoint,integrityOK/
FK0;06:43preservation scans1204files/zero current credential matches,private
env files ignored,four55-file shell manifests match. All-six-family cloud
application,permanent-erasure accounting,private backup/custody/cutoff,hosted,
physical devices,reference/language/a11y and actual CI/release remain open.
See docs/NEON_LOGIN_REHEARSAL.md and docs/PROGRESS_BOARD.md.
Checkpoint:artifacts/production-service-role-checkpoint-2026-10-15.json;
preservation:artifacts/clean-backup-preservation-48a53b54-c313-4211-9b93-
44c0c3fd859c.json. All needed owned test sessions are terminal.

### Earlier Storage Adapter Checkpoint (Historical)

2026-10-15 06:12UTC: **about70% overall** (63-76% uncertainty), storage
integration40%,hosted deployment20%,goal active/productionReady false. Live
isolated private Neon probe passes; explicit hosted Neon adapter now implemented
with shared scoped WAV/source-original integrity, bounded I/O, conditional
creation, exact absence checks and sanitized failures. Migration087 names Neon
in the immutable health journal; existing DB/previews were not migrated or
restarted. Native PostgreSQL proof predates087. Forty-seven focused local tests
pass. Fresh clean snapshot e40616ec-6d21-4ee4-abe7-bb80e27dbe3b terminal0:
locked offline install/build/full1062 tests,1058pass/zero fail/four skips,
239723.087ms;43mocked contract and nine scripted pipeline checks pass;
794 source hashes unchanged. Preservation06:11:25UTC: original eight tables
match prior05:27 checkpoint,integrityOK/FK0;three55-file shell manifests match;
1133selected files/zero current credential matches, both private env files
ignored. Original.env byte-identical through explicit storage-field import.
No cloud application switch, real data, billing action or deployment. All
owned test sessions terminal. Current-branch test object removed, not a claim
of permanent erasure. All six cloud application families, branch-history/privacy
accounting, private backup/custody/cutoff and hosted deployment remain open.
Worker profile source remains in progress with populated functional acceptance
pending, not credited by default-profile/full-regression passes. Evidence:
artifacts/production-neon-storage-checkpoint-2026-10-15.json.

### Earlier Storage Probe (Historical)

2026-10-15 06:01UTC: **about70% overall** (63-76% uncertainty), goal active,
productionReady false. User provisioned the private Neon Free synthetic bucket.
Live isolated S3 probe passed: WAV upload/authenticated byte readback, anonymous
read denied, conditional overwrite rejected, original bytes preserved and owned
probe removed from the current branch. Evidence:
artifacts/neon-storage-3f438b0c-a899-420a-b5ed-a51cefef89d0.json.
Explicit four-field import from ignored.env to ignored.env.neon-storage-test
left source.env byte-identical. No secret values printed;1041 selected source/
evidence files have zero current credential matches. Final focused19tests pass,
zero fail/skips; initial sandbox file-rename EPERM resolved by approved normal
Windows replacement permissions, not weaker assertions. No DB writes, AI calls,
app storage switch, real data, paid upgrade or deployment. Native PostgreSQL80% and
backup/recovery75% unchanged; private Neon application integration25%,hosted20%.
Neon soft-deletes objects and does not enforce stored lifecycle rules: permanent
erasure, all six application families, independent backup/custody and hosted
acceptance remain open. Existing hosted configuration is still R2-specific until
an explicit verified adapter change. Separate worker-role edits remain in progress
and are not credited by this storage-only checkpoint. No owned live test session
or test object remains from the completed probe. Earlier full clean-suite proof
does not cover these new files. See docs/NEON_PRIVATE_STORAGE_TEST_SETUP.md.

### Earlier Backup Checkpoint (Historical)

2026-10-15 05:26UTC: **about70% overall** (63-76% uncertainty),native80%,
backup/recovery75%,clean-setup/release40%. Goal active; productionReady remains
false. Native backup74340 terminal0:neon-backup-162031cf-aee7-4630-9d43-
7d9c4b976a34.json,05:19:18-05:25:34UTC. Real pg_dump/pg_restore18.6, encrypted
DB/object round trip, complete relational/guard comparison, private synthetic
recording byte readback and restored quarantine/activation denied. Both exact
temporary DBs removed, outside catalog/ACL matched, passfiles removed. Earlier
six-minute attempt failed and cleaned; not credited. Remote fixture now has9min
I/O budget inside10min process bound; SQL/assertions/native warnings unchanged.
Official EDB ZIP SHA256 verified;32client files extracted under ignored.tools,
no server/service/PATH install. User-only Windows scratch ACL verified.
Clean snapshot2508 terminal0:bc0bfa2a-4ba4-4ab6-8d36-62073d5f658e under.clean-check,
fresh locked offline install/build,1036tests/1032pass/zero fail/four prerequisite
skips,235546.2492ms;43mocked contract/nine scripted pipeline checks pass;786source
hashes stable. CI now builds before tests that serve dist. Earlier cache/config/
loopback-permission failures preserved. Snapshot predates backup wrapper; latest
backup/clean focused19pass and real native1pass are separate scopes, not a new
combined full-suite claim. Original05:22/05:26 eight table hashes identical,
integrityOK/FK0;original/fresh55asset manifests match;1061selected source/log/build
files contain zero current credentials,.env ignored/exampleblank. Evidence:
clean-backup-preservation-3dee9a71-30cb-4a7a-9b61-e2f0a77f0032.json under artifacts.
All needed owned sessions terminal; both download attempts terminal; no temporary
test databases, workers or API remain. Original3020/3021 previews/data untouched.
No real data, AI/mail/payment calls, paid upgrade or public deployment. GeminiFree
synthetic-only unchanged. Remaining:privateR2/all object families/off-host custody,
backup interruptions/cutoff/privacy replay/activation,separate service profiles,
full reference/language/a11y/physical-device/live-quality/CI/hosted acceptance.
See docs/NEON_BACKUP_REHEARSAL.md,docs/CLEAN_VERIFICATION.md,docs/PROGRESS_BOARD.md.

### Earlier LOGIN Checkpoint (Historical)

2026-10-15 04:52 UTC: **about69% overall** (62-75% uncertainty),native acceptance
75%,read-key85%. Goal active; no production-readiness claim. Native direct LOGIN
run80657 terminal0:artifacts/neon-login-2f94d92b-ffa0-4eaf-ab0f-a3adeb3324bc.json
passed04:38:39-04:40:06UTC. Six checks:two independent verifiedTLS direct runtime
connections,unchanged production permission gate,restricted publish/submit/
scheduled assessment,loopback API startup/health/auth denies,DDL/TEMP/TRUNCATE/
maintenance and future-object denies. LOGIN disabled/password cleared; exact
database/role removed and absence verified;existing catalog/ACL unchanged.
Passwordrandom/30min expiry,never localfile/.env/chat/logged. No real data,
provider/mail/billing/public-deployment action. Provider-side role creation uses
Neon's required unhashed password over verified TLS; unsupported hash attempt
failed cleanly and is separately preserved,not a pass.
Source:server/postgres/neon-login-rehearsal.mjs/scripts/neon-synthetic-login.mjs;
docs/NEON_LOGIN_REHEARSAL.md. Nine focused finaltests pass,2217.4001ms.
Build72554 terminal0:2068modules/670.23KB entry,6.93s;existing size/import warnings.
Suite42430 terminal1:1026tests/1021pass/one failure/four skips,235702.9708ms.
Hosted runtime hit ENOENT while simultaneous npm build replaced a dist asset;
this was test orchestration error,not hidden or relabeled a pass. Evidence
artifacts/neon-login-final-suite-2cf67597-faac-4d1a-a5f5-881f7dd737de.{json,log}.
Stable completed build then hosted focused3/3 pass,2276.1564ms. No assertions or
production behavior changed. Never rebuild dist during tests that load it.
FULL CURRENT SUITE61586 TERMINAL EXIT0:1026 tests/1022pass/zero fail/four explicit
native prerequisite skips,220764.8971ms;189files,OS-only env/no provider/cloud
config,no concurrent build/source edits. Durable passed completion evidence
artifacts/neon-stable-build-suite-110bc507-d1d1-425b-9426-a511da3068fa.{json,log}.
04:51readonly preservation:original eight business fingerprints unchanged,
integrityOK/FK0;55built shell hashes match,1504 source/evidence/public/log files
scanned,zero current Gemini/Neon URL/password matches,.env ignored/exampleblank.
artifacts/neon-login-preservation-ec988671-ca59-401e-909f-7052cca65599.json.
Diff whitespace passes. All needed owned sessions terminal; no test DB/role/API
or owned interrupted worker remains. Earlier failures/interruptions preserved.
30sec checkpoint pause completed04:49 then resumed. NEXT: native encrypted DB/
private-object backup/restore prerequisites and remaining broad worker/PWA/
reference/accessibility acceptance. Existing source must be inspected before
assuming old checklist gaps remain: saved draft target-language editing and the
same-build older-tab shell repair are implemented; different-build/physical
journeys remain partial. Do not rebuild them from stale table rows.
No native LOGIN or test API remains live. Original3020/3021 previews untouched.
Native pg_dump/pg_restore/psql absent on PATH and standard PostgreSQL ProgramFiles
directory absent at04:40;not an exhaustive filesystem inventory. Do not install
systemwide tools without user authorization. Native backup/privateR2,other crash
matrices,separate service profiles,hosted/CI/devices/fullrefs/a11y/language/live
quality/approved real-data AI remain open. GeminiFree synthetic-only unchanged.

### Previous In-Progress Notes (Historical)

2026-10-15 04:39 UTC continuation: goal active,overallabout68%,native acceptance
about70% after actual owned-worker crash/recovery proof; dedicated LOGIN not yet
credited. User explicitly authorized ONE temporary synthetic database and LOGIN
role,with memory-only password/no existing DB ACL changes/no paid resources.
`scripts/neon-synthetic-login.mjs --confirm-synthetic
--confirm-temporary-database-and-login` is the next interruptible action.
New guarded server/postgres/neon-login-rehearsal.mjs creates template0 database,
unique ownership markers and30min expiring SQL-created role; random password is
sent only to Neon over verified TLS,never to local files,.env,logs or artifacts.
Neon explicitly requires unhashed password input; an initial prehashed attempt
failed at role creation (XX000),created NO role and removed its owned DB,with
outside catalog/ACL unchanged. Evidence neon-login-ea74c2d7-9461-4db1-a9ee-
742d0cb0038e.json. This verified-clean failure is not a LOGIN pass.
Existing production
permission configurator applies ONLY in the new DB. Direct TLS/identity/permission
gate,normal publication/submission/scheduled assessment/loopback API and denied
DDL/maintenance/future objects are checked. Cleanup disables its LOGIN and removes
only marker/OID/owner-matched resources after pools close/no client sessions and
outside catalog/ACL comparisons. Drift/lost unmarked CREATE ACK refuses DROP.
SIGINT/SIGTERM request cleanup; forced kills still require journal reconciliation.
Nine focused offline tests pass,2251.9863ms (including actual embedded policy/API,
not native direct-login proof). Related thirteen pre-expiry checks passed.
NEXT native LOGIN run,then full suite and final preservation/credential scan.
Generated artifacts/neon-login-UUID.json journals resource identities before effects.
No LOGIN cloud role has been created yet; capability-only TLS readonly check
passed with CREATE DATABASE/ROLE true. Earlier review-usage error did not execute
the check; after reset it was retried through the same approval path and passed.

Actual process-death native run091c4332-517f-4efd-9dde-991d8eb75a0e passed at
2026-10-14 17:53:25UTC,nine core/seven extended checks,owned child exited after
SIGKILL,one recovery completion/audit after explicit synthetic lease expiry.
Owned schema removed,outside catalog identities unchanged,no provider/realdata.
Journal inspected after interruption; no owned native/worker/test process remained
at19:58UTC. No original terminal exit-code claim for the interrupted70340 handle.
Nineteen focused checks passed before native execution,17867.204ms.
Two final full-suite attempts were interrupted,NOT passes: partial
artifacts/neon-concurrency-guard-suite-2026-10-14.log and
artifacts/neon-final-suite-14257cc2-97fe-4e5e-a535-f21d67cef438.{json,log}.
24843 handle missing/original child24348 absent at04:25UTC; its running journal
is stale,not proof of a live run. Last completed full suite remains1010/1006pass/
zero failures/four native skips,prior to the extended worker and LOGIN additions.
Local-only postgres-live expected migrations updated072to086 without relaxing
its localhost guard; its focused case remains explicitly skipped,not executed.

### Previous Checkpoint (Historical)

2026-10-14 native/read-key continuation: **about68% overall** (61-74% uncertainty),
native acceptance65%,exact read-key85%; goal remains active,not production-ready.
Authorized Neon role run47931 terminal0: nine main/five scoped NOLOGIN checks
passed,86 migrations/checksum/replay and concurrent exactly-once domain work.
`artifacts/neon-rehearsal-7c172712-5b54-4d0a-b7d1-3fcb759e1599.json` records
both roles/schema removed,outside ACLs/roles/catalog identities unchanged.
Production directLOGIN gate deliberately rejected assumed-role instrumentation;
no database-wide/public ACL changes,LOGIN credentials,realdata/provider/mail calls.
Related17 tests pass before batching; final optimized8 pass. Post-role suite82896
terminal0:1010tests/1006pass/zero fail/four native skips,357706.4494ms; log
artifacts/neon-role-guard-suite-2026-10-14.log. Build48668 terminal0,2068modules/
670.23KB with existing warnings. Final17:39 preservation:original eight table
fingerprints unchanged,integrityOK/FK0;55shellhashes match;1482 files scanned,
zero Gemini/Neon URL/password matches,.env ignored/exampleblank. Diff check pass.
Extended native run94939 terminal0,17:45:21UTC:
artifacts/neon-rehearsal-7a2805c4-b087-4e88-8c0b-98f07db4d0bc.json; six checks
pass for one-use grant/session revocation,exact retry/generation race,expired
lease takeover rejecting late completion,payment-versus-void,withdrawal frozen
history,and authglobal/key capacity. Owned schema removed/outside identities
unchanged. Original corecounts are a pre-extension snapshot,not final totals.
Actual process-death test is newly implemented/default-off,offline checks running;
do not credit it yet. It spawns only an owned hidden synthetic worker,requires
run-marker/TLS/job checks,waits for a claim,then targets only that child handle
and verifies exit before explicit synthetic lease expiry/recovery. No native
helper is running; NEXT guarded CLI --confirm-synthetic
--confirm-concurrency-extension --confirm-owned-worker-interruption after focused
tests pass. Final new-source full suite/preservation still required.
Current-build read-key delayed same-page refresh,zero-old-record page transition,
503 cache clear/recovery and paused-template unsent-editor/Cancel/refresh pass.
81596 terminal0:38 reads/eight failures/zero mutations,ten inventories unchanged.
43204 terminal0:publication unchanged,one original template receipt/no new draft/
receipt/external calls. Interrupted25696 reconciled timer-completed exit0,not live.
Owned tabs closed; original browser and previews preserved. Post-role full suite/
preservation passed as above; final extended-worker source acceptance pending. See
docs/NEON_SYNTHETIC_REHEARSAL.md and docs/PROGRESS_BOARD.md. Next: native broader
concurrency/process-death/backup/private-storage and remaining full-scope build;
dedicated service LOGIN/hosted/device/reference/quality/release remain open.

### Historical In-Progress Notes (Superseded Above)

Native Neon rehearsal **passed**,47547 terminal exit0,2026-10-14 16:58:43 UTC.
Evidence `artifacts/neon-rehearsal-e208ca21-ca30-46d5-8f85-d8c65502efd9.json`:
PostgreSQL18 verifiedTLS/direct two-connection preflight,86 migrations/checksums/
zero-change replay,concurrent publication/submission/claimed assessment eachone,
cross-tenant FK/reader denial,immutable publication/audit and exact-version empty
provider journal. Six committed inventories eachone. Owned random schema removed
and absence verified,outside schema/relation/function/type catalog identities
unchanged. Zero realdata/providercalls. This is a bounded native proof,not full
restricted-role/TLS-restoration/concurrency/device/deployment release acceptance.
Seven final offline guard/orchestration tests pass,2721.2141ms; initial PGlite
fixture needed session serialization,not a production guard change or native pass.
Current overallabout67% pending fullsuite/final reassessment. Need final full
regression,source/secret/preservation scan,guarded cleanup failure tests and local
current-build error/paused editor acceptance. Interrupted artifactfixturePID25696
was still live at17:01 UTC; its20min timer may finish soon,recheck before restart.
No other needed owned sessions live. Native goal remains active.

Neon connection-only check **passed**,terminal exit0:PostgreSQL18,verifiedTLS,
two independent native connections,zero application relations/no DBwrites.
Evidence `artifacts/neon-connection-d340a33c-30e0-43bb-b2ab-36eb466e2095.json`.
Dedicated rehearsal now implemented with ownership-marked random schema,all
migrations/checksum/replay,concurrent synthetic publication/submission/assessment,
scope/immutable guards and identity-checked cleanup. Seven offline tests pass;
single-session PGlite fixture serializes only orchestration,NOT native concurrency.
NEXT interruptible action `node scripts/neon-synthetic-rehearsal.mjs --confirm-synthetic`:
write only newly-created synthetic schema and remove only that owned schema after
external catalog identity comparison. Local `artifacts/neon-rehearsal-*.json`
journals phase/run/schema before effects. No role grants,realdata,mail,Gemini,
paid upgrade,public deployment or original preview/database writes. Reconcile
any live handle and journal before repeat; cleanup uncertainty is not a pass.

Active continuation: user confirms isolated Neon Free database ready. Dedicated
URL and isolation flag present,legacy local-test URL unset (values not printed).
`server/postgres/neon-test-config.mjs`, `neon-preflight.mjs` and
`scripts/neon-synthetic-check.mjs` implement direct-host/explicit-isolation/TLS/
empty-target/two-connection checks only. Four offline tests pass,85.7305ms.
NEXT interruptible action: `node scripts/neon-synthetic-check.mjs --confirm-synthetic`
against only the user-configured test target; no migrations/seed/roles/provider
calls. Generated `artifacts/neon-connection-*.json` records checking/passed/failed
without credentials; reconcile journal/owned process before any repeat.
Latest-build browser did attach and proved1500ms same-selection refresh retains
ten operations,while page2 pending showszero earlier operations then exacttwo.
Delayed fixture63170 terminal0:three reads/no mutations,ten inventories unchanged.
Earlier66080 terminal0:32 reads/no mutations,ten unchanged. Interrupted artifact
fixturePID25696 still identified as live,sessionhandle unknown; keep reconciling.
Full goal remains active and older overallabout67% unchanged pending final evidence.

Latest2026-10-14 16:35 UTC: exact read-key state implemented in
`src/useArtifactRead.ts`/`src/artifact-read-state.ts`; provider history retains
only verified same-authority/job/frozen-publication/page metadata while refreshing.
Focused31 pass,4128.9399ms;build2068/670.23KB passes. Full local suite **998 tests/
994 pass/zero fail/four native skips**,340949.8093ms;54530 terminal exit0,log
`artifacts/artifact-read-suite-2026-10-14.log`. Both fixtures terminal exit0:
35352/3237 zero reads/mutations,ten inventories unchanged;23259/3210 no fault
journeys/no extra receipts/fresh drafts,publication unchanged. Zero external calls.
Browser tab creation twice failed webview attachment; no latest-hook browser
verdict. Older screenshots do not prove this new build. Original previews untouched.
Read-key acceptance about70%,other task estimates/overallabout67% unchanged.
Final readonly preservation:original eight fingerprints unchanged,integrityOK/FK0;
55 shell hashes match,1466 source/evidence/public files scanned,zero current-key
matches,exampleblank. Diff whitespace check passes. Needed owned sessions terminal.
User requested Neon Free setup steps; `docs/NEON_FREE_TEST_SETUP.md` now gives
isolated project/direct URL instructions with separate UNDERSTOOD_NEON_TEST_URL.
Correction to earlier question: current UNDERSTOOD_PG_TEST_URL tests explicitly
allow localhost only; NEVER pass Neon URL to those tests or weaken local guards.
No Neon/R2 credentials configured. Dedicated cloud rehearsal remains to implement;
no account creation, cloud connection or deployment occurred. NEXT: resume built
read-key/polling/paused-editor acceptance when browser attaches, then guarded
Neon-specific validation with user-configured isolated target. Goal stays active.

Updated 2026-10-14 16:23 UTC; full production goal remains active. Overall
approximately **67%** (60-73% uncertainty), queue/App helpers **90%**, response
retry **85%**, provider-history acceptance **85%**. Live synthetic AI remains45%.

- Staff-session browser acceptance now **80%** (was65%), not full a11y/device
  acceptance. Cross-tab signal unmounts private editor; explicit two-read recheck
  and final fresh read restore only verified authority. Different account/site
  remains disabled before confirmation. Cookie rotation/revocation after
  observation cannot reopen earlier authority.503/malformed reads fail closed;
  guest, EN/AR/UR, real30-second expiry and focused keyboard recovery verified.
- Delayed periodic check verified actual busy/inert/hidden shell with exact
  unsent text mounted. Same-session release restores exact editor unchanged;
  second held read times out and locks/unmounts it. No app mutation or replay.
  Arabic/Urdu and final expiry at320px documentwidth320,focus on lock heading.
- Focused staff tests23 pass/zero fail,602.5722ms. Existing application code/build
  and full996/992 suite below unchanged. Only disposable harness controls/port/
  graceful stop added this acceptance continuation. Final25402 terminal exit0:
  17 session GETs,zero appPOSTs,six controls,two held reads/one release,nine
  business/audit inventories unchanged,zero external calls. Earlier88254 stopped
  after exact process/script check (exit1); its stdin was closed and it had no
  HTTP stop route,so no final inventory verdict is claimed for that old fixture.
  All temporary tabs closed/viewport reset;original previews untouched.
- Evidence: `docs/STAFF_SESSION_GUARD.md`,
  `artifacts/staff-guard-checkpoint-2026-10-14.json` and screenshots. Wider
  browser transitions/StrictMode/held mutation/account/device acceptance remains.

- S17 job details now expose bounded read-only provider reservations, request
  receipts and recorded result references for preparation/source/voice/check.
  Frozen publication/assignment scope, active staff context and exact DTO checks
  remain enforced. Stable public run identity is an operation ID, not a claim
  token. Private hashes, contexts, bodies, rubric, storage paths and secrets stay
  server-side. No new journal rows, schema, dispatch or result are created by reads.
- HTTP accepted, rejected, unfinished and uncertain receipts are separate from
  validated completion. Reservations with no receipts and historical missing
  provenance are not invented. SQLite reports its absent provider journal honestly.
- Focused27 pass, zero fail,35713.1055ms; full suite **996 tests/992 pass/zero
  fail/four native skips**,358508.2645ms,90327 terminal exit0. Strict build passes
  (2067 modules/669.55KB entry); existing bundle/import warnings remain.
- Built normal queue, page1/page2, keyboard table focus, explicit refresh,
  synthetic503/error/recovery,320px and settled auditor reads verified. 320px
  document305px, native request tables scroll internally. Current/historical
  claims share stable run IDs across pages. Response remains pending and unchanged.
- Two disposable fixtures terminal: first55568,85 reads/13 failed reads/zero
  mutations; final72273,7 reads/zero mutations. Both ten protected inventories
  unchanged,zero external calls. Constructed browser metadata is not live-provider
  evidence. Corrected fixture-only encoded hash shortcut; normal queue and final
  corrected bootstrap work. Temporary tabs closed,viewport reset.
- Original eight fingerprints/counts unchanged,integrityOK/FK0;55 shell hashes
  match;1454 source/evidence/public files scanned with zero current-key matches;
  exampleblank. Original3020/3021 and stored database untouched. No paid/cloud,
  real data, external diagnostics or live provider calls this continuation.
- Evidence: `docs/PROCESSING_PROVIDER_HISTORY.md`,
  `artifacts/provider-history-checkpoint-2026-10-14.json` and suite/screen captures.
- NEXT: wider staff authority-transition acceptance and strict read-key continuity;
  frequent processing polling currently briefly replaces history with loading.
  Native journal/concurrency, independent language/audio/device/all44references,
  privacy-approved real AI and authorized hosting/release gates remain open.

## Earlier Response Retry Checkpoint

Updated 2026-10-14 15:35 UTC; full production goal remains active. Overall
approximately **67%** (60-73% uncertainty); queue/App helpers **90%**, customer
response-retry recovery **85%**. Live synthetic AI remains45%; no release verdict.

- S17 failed voice-processing and durable typed-answer-check retries now have
  exact scoped confirmed intents and immutable generation/actor receipts on both
  supported backends. Migration086 and SQLite journal preserve frozen assignment/
  publication binding. SQLite inline checks are completed, never fabricated as
  pending/retryable work. Operator retry receipts also advance typed generation.
- Historical exact replay returns original receipt without resetting a later
  failure or completed outcome. Only pending checks/unassessed received voice can
  queue. Active actor/worker, elapsed audio/text policies, purge/deletion/content
  fences and normal dispatch/provider gates remain enforced. No operator access
  delegated to staff, provider enabled, completed assessment changed or answer
  replaced. New HTTP JSON paths require captured session context before effects.
- Shared UI retains tab-scoped exact intent, resolves receipt reads without a
  POST and exposes original-request retry only after a missing receipt. Matching
  ACK plus receipt and current completion are required before cleanup. Same-job
  verified metadata stays mounted during refresh, with mutations disabled while
  loading; errors/changed authority discard the display cache. Acceptance status
  now survives refresh. Wider transition/native/device acceptance remains.
- Final full suite `artifacts/response-retry-suite-2026-10-14.log`: **990 tests,
  986 pass, zero fail, four native skips**,297041.3484ms;44465 terminal exit0.
  Focused retry/privacy/client/populated-import26 pass,17596.4944ms;80318 terminal.
  Earlier focused17 pass; early fixture failures were corrected without reducing
  assertions or loosening production guards. Build2065 modules/660.49KB passes;
  existing chunk/mixed-import warnings remain. `git diff --check` passes.
- Built voice and typed lost-ACK/reload/read-only recovery, precommit outage/
  missing receipt/explicit original retry, preserved typed answer/pending outcome,
  keyboard,320px and settled auditor controls verified. Final document305px at
 320 viewport. Screenshots in `artifacts/response-retry-*`.
- Final disposable fixture63254 terminal:four POSTs/two lost ACKs/one precommit
  outage/two failed receipt reads/one missing receipt/three immutable receipts
  (voice gen0,typed gen0/1). Seven business inventories unchanged,zero external
  calls. Earlier60016 terminal:one POST/one receipt; temporary tab closed and
  viewport reset. All needed owned sessions terminal.
- Read-only original eight fingerprints/counts unchanged,integrityOK/FK0;55 shell
  hashes match.1383 nonignored source/evidence files/public assets contain zero
  current-key matches;exampleblank. Original3020/3021 previews not migrated or
  restarted. No real data, live provider calls, diagnostic upload, paid services
  or cloud deployment this continuation. Populated local backup/import preserves
  exact retry receipt and historical replay without another queue action.
- Evidence: `docs/RESPONSE_PROCESSING_RETRY.md` and
  `artifacts/response-retry-checkpoint-2026-10-14.json`.
- NEXT major task: S17 safe run-level provider provenance for voice/check jobs,
  tied to existing journal identities and exact publication inputs. Preparation
  already exposes per-attempt stages. Inspect current operation/request schemas;
  expose verified bounded metadata only, never transcript/rubric/hash/object/key
  data or a falsely successful pipeline. Full original goal/gates remain intact.
  Actual checkpoint pause: 30.0322 seconds, then resumed reading provider quota/
  request journal, immutable audio completion links and current job detail DTO.
  Earlier operations may be unattributed; reserved allowance, HTTP acceptance and
  validated job completion must remain distinct. No provenance UI claim yet.

## Earlier Mixed Queue Checkpoint

Updated 2026-10-14 11:26 UTC; full production goal remains active, all 44 references
and original production requirements retained. Overall about **66%** (59-72%
uncertainty). App helpers and S17 mixed customer queue **85%**; processing-request
recovery **80%**, live synthetic AI **45%**; remaining weighted areas unchanged.

- S17 now reads accepted source transcription, worker voice transcription and
  answer checks alongside preparation on both backends. Scoped SQL pages/counts,
  typed IDs, immutable publication title/version/assignment binding, strict client
  DTOs and redacted metadata are verified. SQLite actual inline synthetic checks
  are labeled separately from durable PostgreSQL jobs. No fabricated pending jobs.
- Source JSON reads/retry receipts and writes require captured session context;
  native private audio/original downloads remain cookie-authenticated. Source
  history and retry completion honor current mounted staff authority. Explicit
  source retry is reused from the job detail, never automatically reposted.
- Full suite log `artifacts/processing-kinds-verified-suite-2026-10-14.log`:
  **974 tests, 970 pass, zero fail, four native skips**, 270430.2005 ms, handle
  36298 terminal exit 0. Initial suite 76098 found one preparation-only count
  assertion; corrected to assert both preparation and actual completed checking,
  without reducing coverage. Focused source/client/session checks: 54 pass.
- Final strict build: 2062 modules, 653.49 KB entry; existing chunk/mixed-import
  warnings remain. Built desktop and 320px queue/filter/pagination/voice history/
  explicit source retry/reload/keyboard/upload destination journeys pass locally.
  Fixed 320px response button overflow; final document width 305 at viewport 320.
  Background job polling stops while exact response history is open, preventing
  repeated history unmount/audio interruption. No all-reference/a11y verdict.
- Final disposable fixture 38737 is terminal: 12 processing reads, one explicit
  retry, seven protected business inventories unchanged, zero external calls.
  Earlier fixture runs also terminal. Temporary tab closed and viewport reset.
- Eight original table fingerprints/counts unchanged; read-only integrity OK,
  FK violations zero. All **55 current shell hashes** match. Initial shell check
  used wrong metadata property `sha256`; corrected against actual `hash` field.
  1364 nonignored source/evidence files and public assets contain zero current-key
  matches; `.env.example` blank. No original migration/restart, provider call,
  real data, external diagnostics, paid service or deployment this continuation.
- Evidence/limits: `docs/PROCESSING_JOB_KINDS.md` and
  `artifacts/processing-kinds-checkpoint-2026-10-14.json`.
- NEXT: inspect S17 failed response/check job recovery and provenance against
  existing durable operators and worker retries. Establish exact scoped customer
  intent/receipt contracts before adding controls; never change an earlier answer,
  invent native acceptance, enable Gemini on real data or delegate operator access.
  Actual checkpoint pause: 30.0292 seconds, then resumed inspection of recording/
  assessment workers, claim guards and operator retries. Customer recovery must
  preserve frozen assignment/input, pending-only check completion, deletion/text/
  audio expiry and dispatch/provider gates; retry generation cannot rely solely on
  an attempt counter that resets to zero. No operator method reused as staff access.

## Earlier Processing Recovery Checkpoint

Updated 2026-10-14 10:18 UTC; spec 2026-10-02; root `D:/understod`; Git
`main`/`2060776`. Full production goal remains active against all 44 references.
Lead owns current integration; earlier unrelated/uncommitted work preserved.

- Locally verified S09/S10/S17/S39/S42 and A06/A08: immutable processing receipts,
  exact generation/replay, captured paths and shared draft/job tab recovery, with
  built interruption/reload/keyboard/320px proof and populated SQLite import.
  Main changes: preparation modules, migration 085, HTTP/context/runtime/import
  integration, PreparationRequest/recovery/main, tests and fixture. Details:
  `docs/PROCESSING_REQUEST_RECOVERY.md`.
- Gemini authorization keys supported as opaque bounded header-safe secrets;
  user's key works. Four live fixed synthetic assessment cases pass. Latest full
  workflow completed actual metered preparation/translation/four speech tracks,
  private publication, immutable snapshot and scoped playback checks; ninth
  external request (extra synthetic answer voice) returned 429. No transcription
  or voice assessment occurred; no auto retry. Artifact:
  `artifacts/gemini-workflow-ece9080e-052b-4b01-bd29-7cfcde39359b.json`.
- Final command: clean environment `node --test tests/*.test.mjs`, log
  `artifacts/processing-key-verified-suite-2026-10-14.log`: 967 tests, 963 pass,
  zero fail, four native skips, 255519.1153 ms, handle 15865 terminal exit 0.
  Focused integration 32 passes and final key/adapter/workflow 24 passes.
  Strict build 2060 modules/638.79 KB entry, existing warnings unchanged.
- Eight original fingerprints/integrity OK/FK zero rechecked after tests/live run.
  56 shell hashes matched; 1353 tracked/untracked source/evidence files and public
  assets contained zero current-key matches; `.env.example` blank. No original
  migration/restart, real worker data, external diagnostics, billing or deployment.
- Owned live runner 23682 and fixture 66948 are terminal. Fixture graceful timeout
  preserved seven business inventories, three receipts/five POSTs, zero external
  calls. All needed owned commands terminal; temporary tab closed/viewport reset.
  Unknown old 33515 result is not claimed; historical evidence remains below.
- Overall estimate about 65% (58-71% uncertainty). App-owned helpers 80%,
  processing-request recovery 80%, live synthetic AI 45%; other areas unchanged.
  Native/cloud/real-data/Urdu speech/quality/all-reference/a11y/device/release
  gates remain open. No production-ready verdict.
- ONE next task: finish S17 staff queue coverage beyond `jobs` preparation:
  source transcription, voice response transcription and typed answer-check
  repositories are not included in its current paged read model. Inspect current
  schemas/read DTOs and existing source/response destinations, agree bounded
  tenant-safe contracts, then implement both backends/UI and verify. Preserve
  exact published-version outcomes and do not expose transcripts/rubrics/leases.
  Actual checkpoint pause: 30.0228 seconds, then resumed this inspection.

## Earlier 14 October Continuation

Active continuation 2026-10-14 09:37 UTC: full synthetic workflow runner is locally
verified, not live complete. All three live workflow attempts are terminal; the
first two exposed grounding shape gaps and the third passed grounding/translation/
three speech tracks but stopped at HTTP 429 on Arabic question speech, with no
publication. Artifact: `artifacts/gemini-workflow-1673569f-9138-4988-b972-7064e56cc468.json`.
One live text assessment stopped on invalid output; its cause is not proven.
Strict preparation schema/question pairing and assessment reason/evidence bounds,
case-sensitive quotes and current evaluator provenance are repaired. Final focused
command: `node --test tests/gemini-adapter.test.mjs tests/gemini-synthetic-smoke.test.mjs
tests/evaluation.test.mjs tests/assessment-provider.test.mjs
tests/gemini-synthetic-workflow.test.mjs`: 37 pass, zero failures/skips,
22116.2905 ms, handle 69159 terminal exit 0. Earlier 39-pass run also terminal;
the interrupted 33515 handle is missing, so its result is not claimed.
The new key in ignored `.env` fails the local Google-format check; the attempted
four-request text smoke exited before network dispatch. User asked to correct it
without sharing it. A new key is not evidence of project quota relief. Command
review access recovered after the earlier usage-limit rejection; no bypass used.
Full-suite/build/preservation evidence below belongs to the earlier source; a
fresh full checkpoint is still required. Original database/previews untouched.
Processing recovery implementation now in progress: migration 085 and equivalent
SQLite immutable scoped receipts, exact queue-generation admission, original-actor
GET recovery and captured new HTTP paths; shared tab-scoped UI replaces draft/job
commands and requires matching ACK plus immutable receipt before cleanup. Initial
regression had a missing secondary-staff fixture, repaired without assertion change.
Final 32 related checks pass (2121.9984 ms); strict build passes, 2060 modules,
638.79 KB entry, existing chunk/dynamic-import warnings unchanged. Full processing
suite now terminal: 966 tests, 962 pass, zero fail, four native skips,
264676.6713 ms, handle 87515 exit 0. First full run had five pinned-migration
list/count failures; explicit 085 expectations added without weakening assertions.
Populated SQLite processing receipts import/replay and embedded runtime roles pass;
32 integration checks pass (18640.6403 ms). Built browser confirms lost ACK/reload,
receipt outage, later 503 rejection retaining uncertainty, read-only recovery,
edit locks, explicit initial retry and 320px controls/keyboard check. Screenshots
are local; no Reticle verdict or full reference/a11y acceptance claimed. Fixture
66948 remains live until its 20-minute graceful timeout; stdin is closed, so do
not restart it or claim shutdown. Temporary browser tab closed and viewport reset.
Eight original fingerprints/integrity/FKs and 56 shell hashes rechecked unchanged.
Correction: Google's new authorization keys invalidate our AIza-only assumption.
User was correct. Prefix check replaced with opaque bounded header-safe validation;
24 final adapter/smoke/workflow tests pass (10509.1582 ms). New key successfully
ran four real fixed synthetic text assessments; complete matched, incomplete
clarification, contradictory and injection unassessable. Evidence:
`artifacts/gemini-synthetic-assessment-1791972360409.json`. No real data or billing.
Next interruptible actions: final clean synthetic suite after the key compatibility
change and ONE new isolated capped full workflow after the verified Pacific daily
quota reset (previous refusal Pacific 13 October, current 14 October). Max 15
external requests; no blind retry after failure. Preserve each metadata artifact.
ONE next task: reconcile these specific handles/artifacts and the fixture timeout,
checkpoint evidence, then resume larger reference/localization/accessibility work. Overall remains
about 64%, live AI 40%; no native/cloud/real-data or production promotion.

Updated: 2026-10-14 06:23 UTC. Spec 2026-10-02; root `D:/understod`;
Git `main` at `2060776`, with local implementation/evidence changes not committed.
Current goal remains full production against all 44 references, not a narrowed MVP.

- App-owned captured transport checkpoint: 75%, requirements A06/S01/S08/S13/S17/
  S31/S37/S42. Overview/briefing/processing/audit/readiness reads and staff
  process/sign-out callbacks capture original authority. Broken retry header fixed.
- Verified: final 176-file/954-test suite, 950 pass, zero fail, four native skips,
  terminal exit 0 (220901.3975 ms). Strict build/56 shell hashes/eight original
  database fingerprints, integrity OK/FK zero pass. Built retry/lost ACK/read/
  activity-native CSV/readiness/auditor/sign-out evidence passes. All owned commands
  terminal; temporary tabs closed. No original restart/migration. Google synthetic
  requests occurred in the later Gemini checkpoint; no diagnostic/cloud operation.
- Gemini Free technical task: 40%. Local key verified and kept out of tracked/public
  files. Live fixed preparation, AR/UR translation checks and EN/AR speech pass;
  protocol and real WAV normalization defects repaired. Complete live pipeline,
  transcription/assessment and independent quality/Urdu speech remain open.
- Current overall estimate: about 64% (57-70% uncertainty), dated reassessment in
  `docs/PROGRESS_REASSESSMENT_2026-10-14.md`. Per-task checklist:
  `docs/PROGRESS_BOARD.md`; evidence: `docs/APP_REQUEST_FENCING.md` and
  `docs/GEMINI_LIVE_CHECKPOINT_2026-10-14.md`.
- Partial: stricter DTOs, durable per-request processing retry recovery, account
  transitions and wider authority/keyboard/Strict Mode/device/native acceptance.
- Unverified release gates: all-44 fidelity, complete localization/accessibility,
  actual phones/audio/offline, native DB/backup/restore/CI, live synthetic pipeline
  and independent quality, privacy-approved real-data path and authorized hosting.
- Next: complete the isolated live synthetic metered pipeline, then close larger
  remaining acceptance/features using current source/register,
  with processing recovery/DTO/account helpers tracked explicitly. Neon Free only;
  Gemini Free synthetic only. Preserve original DB/previews; diagnostics stay local.

## Historical Checkpoints

- Actual private-worker checkpoint pause: 30.0322 seconds, then resumed RetentionSettings/RecordingNoticeSettings/TextRetentionSettings and receipt helper inspection. Their policy GET/save/receipt paths still use raw unbound fetches, and audio/notice catches can clear a previously uncertain original after later known 400/401/403/409 rejection. Audio direct save checks only next revision before clearing rather than fetching the exact accepted receipt; helpers clear by ID without rechecking complete saved intent. Authority already reaches RetentionSettings from main, but notice/text child callers still need propagation. Preserve EN/AR/UR notice scope, all six policy categories, disabled settings and scheduled cleanup semantics. The combined read output truncated part of TextRetentionSettings, so re-read its actual current source before editing. All owned required commands terminal; private-worker checkpoint parses with 879 passes/productionReady false. Goal active.

- Current private worker/response checkpoint 2026-10-13 13:42 UTC: WorkerAccess list/issue/revoke and private clipboard now capture full original authority, validate selected worker and redacted metadata, require fresh status after uncertainty, keep bearer only in memory and clear at modal/link/session expiry. Clipboard uses immutable original session/grant and fresh scoped session read; cannot adopt a changed identity or report success after selection changes. WorkerDeletion has versioned abortable reads and guarded exact submitted-ID/reason completion from People and PrivacyWorkers (via RetentionSettings); unsent review nonce is separate from submitted intent. Privacy directory and publication/worker assignment/detail reads use shared captured transport; server middleware rejects stale/missing private-control/privacy/response context before grant/session/deletion/business/audit effects. Native audio unchanged; parent retention/notice/text settings NOT claimed migrated. Test-first dual-backend 200-vs-409 privacy failures corrected by enforcement. Initial 33-pass focused regression preceded final intent/snapshot corrections; final affected four-file 18-pass regression (3.720s), strict build 2041 modules/592.26 KB, 69 shell hashes/eight original fingerprints/integrity/FKs pass. Final full synthetic suite after all source changes: 165 files/883 tests/879 pass/zero failed/four native skips, terminal exit 0 (326.513s), log artifacts/worker-controls-suite-2026-10-13.log; handle 5166 terminal, all owned required commands terminal/no owned server. Preservation rechecked after full completion. Current browser inventory failed at CreateProcessSecurityEnvironment 0x80070020; no rendered verdict, original restart/migration, provider/mail/cloud operation or external diagnostic upload. docs/WORKER_CONTROL_FENCING.md and artifacts/worker-control-checkpoint-2026-10-13.json record limits. Boundary 75%, whole staff request fencing 80% (was 75%), overall about 60% (55-65% uncertainty), not production-ready. Next major boundary: RetentionSettings, RecordingNoticeSettings and TextRetentionSettings capture/receipt/retry/completion, preserving earlier uncertain saves after later known rejection and current policy receipts; then remaining workspace/template/glossary/report/notification/App callbacks. Goal active.

- Actual CSV checkpoint pause: 30.0215 seconds, then resumed private worker-access/deletion/clipboard caller inspection. WorkerAccess still has unbound list/issue/revoke fetches and direct clipboard writes without a fresh original-context session check; WorkerDeletion still uses a local live ref rather than captured authority for read/post/queued/lock callbacks. People owns both, while PrivacyWorkers is a second actual deletion caller; assigned responses have separate raw-read transport. Existing scoped clipboard behavior is in src/artifact-review.ts/ArtifactCopy.tsx, not an assumed artifact-copy.ts filename. Preserve explicit replacement of private links (never auto-issue) and immutable deletion request/progress semantics when migrating all actual callers. All owned required commands terminal; import checkpoint JSON parses with 874 passes/productionReady false. Goal active.

- Current CSV import checkpoint 2026-10-13 12:45 UTC: raw preview/upload/load/confirm/recovery use captured authority and guarded exact-intent completion. Shared transport adds a POST-only 1 byte-256 KiB CSV Blob format at the single preview endpoint, exact query names, 15s timeout/mount abort; original JSON behavior stays tested. Recovery persists only original actor/site/org-scoped request ID/content and filename fingerprints/phase/size, never CSV/worker labels/filename plaintext. Both backend private preview projections carry immutable fingerprints, including original filename identity after deletion minimization; no schema migration. Context policy covers import JSON/raw mutations but preserves cookie-only native errors.csv. Automatic recovery sends GET only; retries are explicit unchanged file/import actions. Initial raw-serialization and missing-route-context tests failed before implementation. Final focused seven-file 36-pass regression (20.989s), strict 2040-module/589.68 KB build, 69 shell hashes/eight protected original fingerprints/integrity/FKs pass. Final full synthetic suite after all source changes: 164 files/878 tests/874 pass/zero failed/four native skips, exit 0 (313.102s), log artifacts/import-request-suite-2026-10-13.log; handle 37127 terminal, all owned commands terminal/no owned server. Two browser inventory attempts failed at trusted runtime startup; no rendered verdict, original restart/migration, provider/mail/cloud operation or external diagnostic upload. docs/IMPORT_REQUEST_FENCING.md and artifacts/import-request-checkpoint-2026-10-13.json retain scope and limits. CSV boundary 75%, whole staff request fencing 75% (was 70%), overall about 60% (55-65% uncertainty), not production-ready. Next major boundary: private worker-link/list/issue/revoke/clipboard authority plus deletion request/receipt callbacks and assigned-response reads; preserve existing no-auto-link replacement and immutable deletion/progress semantics. Goal active.

- Actual People checkpoint pause: 30.0316 seconds, then resumed CSV import schema/parser/receipt and session-cleanup inspection. WorkerImport still uses raw unbound preview/load/confirm requests; transport uncertainty during confirmation needs a read-only exact-import status lookup rather than blind resend. Existing parser is csv-parse, previews freeze request ID/file hash/filename and confirmations already replay atomically without new grants. Preserve native errors.csv downloads. Next implementation should reuse captured staff authority with a bounded raw CSV path, exact preview/outcome validation and current-view completion; do not count import/access/deletion/assignment boundaries as covered by People management. All owned commands terminal; full checkpoint 868 passes/productionReady false/goal active.

- Current People checkpoint 2026-10-13: actual invitation checkpoint pause 30.0277 seconds, then resumed worker/import/access inventory. Worker/crew directory management now captures authority through actual People caller/crew lifecycle/reactivation/membership views, aborts reads, holds mutations and fences completion plus selected-worker/form changes. Narrow server predicates require context on migrated JSON routes only; CSV/native errors, private access/deletion/assignment helpers remain separate. Test-first missing-context failures on both backends fixed by enforcement. Focused seven-file 33-pass regression (10.504s); final combined full suite AFTER final invitation/People source changes: 163 files/872 tests/868 pass/zero failed/four native skips, terminal exit 0 (314.318s), log artifacts/people-request-suite-2026-10-13.log. Strict build 2039 modules/580.75 KB entry, 69 shell hashes and eight original fingerprints/integrity/FKs pass. Test 93427/build 13775 terminal; no owned required sessions remain. Worker/crew boundary 75%, whole staff request fencing 70% (was 65%), overall about 60% (55-65% uncertainty), not ready. docs/PEOPLE_REQUEST_FENCING.md and artifacts/people-request-checkpoint-2026-10-13.json record scope and remaining gates. No browser/native/deployment promotion, original restart/migration or external operation. Next ONE boundary: CSV raw-byte preview/load/confirm and read-only uncertain confirmation recovery; use existing csv-parse/immutable import IDs, preserve native errors.csv links and scope before extending policy. Goal active.

- Current invitation checkpoint 2026-10-13: actual billing checkpoint pause 30.0344 seconds, then resumed. StaffInvitations list/issue/resend/cancel/receipt/retry now use captured authority with guarded asynchronous exact-receipt completion and changed-intent cleanup denial. Shared middleware rejects absent/stale context on both backends before invitation/mail/token/receipt/audit side effects; public invitation acceptance untouched. Initial test-first two failures corrected by enforcement, not weaker assertions. Focused six-file 40-pass regression (13.121s), neighboring billing/restore 14-pass regression (7.946s), strict build (2039 modules/579.75 KB), 69 shell hashes and eight protected original fingerprints/integrity/FKs pass. All owned commands terminal. Earlier full 866-pass suite ran before invitation changes, no newer full-suite claim. Invitation boundary 75%, whole staff request fencing 65% (was 60%), overall about 60%, not ready. docs/INVITATION_REQUEST_FENCING.md and artifacts/invitation-request-checkpoint-2026-10-13.json record remaining browser/native/mail/full-release gates. No original restart/migration, live API/mail/cloud operation or external diagnostic upload. Next independent major boundary: workers/people/import/access views and their receipt recovery; scope current source before editing. Goal active.

- Current billing checkpoint 2026-10-13: captured authority now fences invoice reads/create/manual payment/void/receipt recovery, with exact canonical-intent receipt hashes and guarded saved-record cleanup. Both HTTP backends deny stale/missing context before ledger/audit side effects; native cookie-authenticated invoice downloads remain usable. Initial outdated SQLite expectation fixed without weakening assertions. Focused 17-pass regression; full 163-file/870-test suite passes 866 with zero failures/four native skips, exit 0 (312.734s), after all source changes. Strict build passes (2039 modules/579.70 KB entry), all 69 shell hashes match, eight original database fingerprints/integrity/FKs match. Test 91697/build 65027 terminal. Browser runtime reload/retry failed at startup (0x80070020), no rendered verdict or external diagnostics. Billing boundary 75%, whole staff request fencing 60% (was 50%), overall about 60% (55-65% uncertainty), not production-ready. See docs/BILLING_REQUEST_FENCING.md and artifacts/billing-request-checkpoint-2026-10-13.json. No original restart/migration or external rollout. Next major boundary: StaffInvitations list/issue/resend/cancel/receipt/retry, preserving exact private receipts and unchanged recovery. Goal active.

- Actual optional-edit checkpoint pause: 30.0342 seconds, then resumed billing source/route inspection. Billing.request still lacks captured context across invoice list/detail/create/manual payment/void and receipt recovery, with async paths clearing saved records or invoking callbacks without current-view authority. Separate JSON routes from cookie-authenticated native invoice downloads so ordinary links remain usable. Preserve exact cents, immutable invoice identity, owner writes/auditor reads, request replay and earlier uncertainty; this records manual payments and must never imply a real card charge. Optional checkpoint JSON parses with full 862 passes/final affected 14 passes/productionReady false. All owned commands terminal; goal active.

- Current checkpoint 2026-10-13 10:54 UTC, A06/S10-S13/S18/S42: optional source/translation edits and target regeneration now use captured StaffRequestAuthority through BriefingDetail/LanguageArtifacts, abortable scoped receipt reads, bounded expired-review verification and guarded success/recovery cleanup. Both HTTP backends require context on review/regenerate and their GET/verify receipts. Test-first missing-header regressions failed before implementation. Fixed real earlier-review uncertainty being forgotten after a later known retry rejection; tested shared retention policy preserves unresolved originals. Full suite before that final adjustment: 163 files/866 tests/862 pass/zero failed/four native skips, terminal 0 (297.658s), log artifacts/optional-edit-full-test-2026-10-13.log. Final affected four-file 14-pass regression (5.112s) and strict 2038-module build/68 hashes/eight original fingerprints/integrity/FKs pass afterward; existing warnings remain. Full handle 57645/build handle 54220 terminal; no owned servers or other required commands running. Inline rewrite rejected without source changes; direct apply_patch succeeded, no bypass. No new browser verdict, original restart/migration, live API/mail/cloud operation or external diagnostics. docs/OPTIONAL_EDIT_FENCING.md and artifacts/optional-edit-checkpoint-2026-10-13.json record limits. Estimates: optional edit boundary 75%, whole staff request fencing 50% (was 40%), staff lock/recovery 65%, overall about 60% (55-65% uncertainty), goal active, not ready. ONE next high-impact task: captured-context billing list/detail/create/manual payment/void and receipt recovery, fencing callbacks before persisted-record cleanup and retaining prior uncertainty; preserve owner/auditor separation, exact cents/replays and no actual card-charge semantics. Remaining helpers and native/live/cloud/full-reference/a11y/device/release gates stay open.

- In progress optional edit/regeneration continuation: DraftReview and Regeneration now use captured authority and guarded completion through all actual BriefingDetail/LanguageArtifacts callers, with abortable scoped receipt GETs and bounded expired-review verify POSTs. Both backends require matching context for optional edit/regenerate and their GET/verify receipts. Test-first extensions failed on both backends before middleware change; related 13-pass regression and TypeScript pass afterward. Found and repaired prior review uncertainty being discarded after a known later retry rejection; shared tested retention policy preserves the original unresolved request. Full suite handle 57645 is live, log artifacts/optional-edit-full-test-2026-10-13.log, started before final retention-policy adjustment; build handle 54220 state must be reconciled before any rerun. Rejected inline source rewrite made no changes; direct apply_patch caller edits succeeded, no bypass. Final related/build/preservation/browser proof pending. Goal active; no original migration/restart or external operation.

- Actual briefing checkpoint pause: 30.0478 seconds, then resumed optional edit/regeneration source and route inspection. Confirmed DraftReview.requestReview and Regeneration.requestRegeneration still omit captured context; their GET/POST/verify and recovery success/error paths can clear saved records or invoke latest callbacks after async work without per-view authority checks. LanguageArtifacts owns translated edits/regeneration while BriefingDetail owns source review and recovery; propagate the already established StaffRequestAuthority through those actual callers. Preserve exact private review hashes, target regeneration receipts, immutable published versions and OPTIONAL edits, with no new approval gate. Saved checkpoint JSON parses and reports 862 final passes/productionReady false. All owned commands terminal; goal active.

- Current checkpoint 2026-10-13 10:34 UTC, A06/S09-S13/S18/S42: core briefing requests now capture full original staff authority through library/detail/creation/source PATCH/copy/archive/exact withdrawal/publish/schedule/cancel/receipt/retry, plus source-upload dispatch/completion checks and recipient reads. Guarded asynchronous completion preserves exact saved IDs and prevents old-view cleanup/success/navigation after receipt hashing. Both HTTP backends require mapped JSON headers; native private-byte audio URLs remain ordinary cookie-authorized requests. Fixed a real PostgreSQL context denial swallowed as schedule 503: common error handling now preserves 409. Test-first missing-header regressions failed before implementation; initial full run exit 1 (864 tests/856 pass/four failures/four native skips) exposed an intentional-login audit baseline and three legacy metadata reads without headers; repaired without removing assertions. Final full suite: 163 files/866 tests/862 pass/zero failed/four native skips, terminal 0, 263.140s. Final related five-file 49 pass, terminal 0 (218.576s), strict 2038-module build/68 hashes/eight original fingerprints/integrity/FKs pass. All owned test/build handles terminal (48378 failed initial, 41223/69948 final pass, 79738 build pass). No new browser verdict: prior trusted browser runtime startup issue remains unresolved; no diagnostic upload, original restart/migration or external service/deployment operation. docs/BRIEFING_REQUEST_FENCING.md and artifacts/briefing-request-checkpoint-2026-10-13.json record scope/limits. Estimates: core briefing boundary 75%, whole staff request fencing 40% (was 25%), staff lock/recovery 65%, overall about 60% (55-65% uncertainty), goal active, not ready. ONE next major task: migrate optional DraftReview/Regeneration and their receipt/retry/LanguageArtifacts callers to captured authority and guarded completion, preserving immutable published artifacts/exact IDs/no required human approval; require matching headers at those actual SQLite/PostgreSQL routes. Other staff helpers/native/live/cloud/full-reference/a11y/device/release gates remain open.

- Verification continuation: first full briefing run handle 48378 is terminal exit 1 (864 tests/856 pass/four failures/four native skips, 296.214s). Corrected the intentional sign-in baseline and two normal HTTP fixture clients whose three briefing metadata reads omitted context; no behavioral assertions removed. Test helper now shares the JSON-route policy and leaves native audio requests without an automatic custom header. Added policy/helper tests proving fixed capture per cookie and preservation of deliberate bad headers. Final related five-file regression handle 41223 and final full suite handle 69948 are running; final full log artifacts/briefing-request-full-test-final-2026-10-13.log. Strict build handle 79738 is terminal exit 0 (2038 modules, existing warnings). Do not duplicate live suites or claim final green results yet. docs/BRIEFING_REQUEST_FENCING.md records scope, initial failures and remaining migration/browser/native/release gates.

- In progress briefing-family continuation, 2026-10-13: scoped PATCH plus asynchronous receipt-completion guards now propagate through creation/editor/copy/archive/withdraw/publish/schedule/receipt/retry and source upload callback boundaries. Both backends require exact headers for briefing JSON library/detail, selected mutations, schedules and exact creation/publication receipts; native audio URLs are not forced to carry an impossible custom browser header. PostgreSQL's route-specific schedule error mapper was swallowing context mismatch as 503; common middleware now preserves 409 before route-specific classifiers. Corrected new fixture seeding, and captured the intentional second login before preservation baselines (PostgreSQL correctly audits sign-in). Full synthetic suite running under handle 48378, log artifacts/briefing-request-full-test-2026-10-13.log, started before final fixture baseline correction; do not claim it green or duplicate it until terminal. TypeScript passes; final related/browser/preservation/build proof still pending. Existing legacy HTTP fixture clients now capture one context per synthetic cookie rather than dropping headers; explicit negative context tests remain raw fetch. Goal active, original previews/database untouched.

- Actual request checkpoint pause: 30.0255 seconds, then resumed briefing-family source/caller inspection at 2026-10-13 09:48 UTC. Confirmed unbound shared BriefingControls.request is used by source PATCH, copy/archive/withdraw, typed draft creation/recovery, publication/schedule and receipt/retry; PublishForm also uses it for worker/crew recipient reads. Callers reside in App/BriefingDetail/PublicationHistory. Exact receipt validators and saved IDs already exist and must remain intact. Next change must propagate captured authority through these real callers, handle PATCH explicitly, and recheck liveness after asynchronous draft-result validation before clearing recovery or navigating. Do not replace exact IDs/receipts with a fresh request or introduce global latest-session adoption. All owned commands are terminal; goal stays active.

- Current checkpoint 2026-10-13, A06/S30/S42: Staff & Access now uses immutable captured staff context for directory/change/receipt/retry with per-view mount-generation aborts, pre/post transport/JSON/expiry checks, held dispatch/completion during verification, and guarded recovery-store cleanup. Main post-change refresh cannot auto-adopt another identity. Both SQLite/PostgreSQL HTTP routes require matching headers before every staff-directory/mutation/receipt handler. Test-first denials failed before implementation, then combined final six-file 28 tests passed (6.603s). Full synthetic suite: 161 files/860 tests/856 passed/zero failed/four native prerequisite skips, terminal 0 (277.646s); began before final pending-completion adjustment, covered by the final related regression/build afterward. Strict 2038-module build/68 shell hashes/eight original fingerprints/integrity/FKs pass; existing warnings remain. Full test handle 82964 and build handle 46325 are terminal; no owned server running. Two browser inventory calls exited at trusted Node startup, including requested reset retry; no browser verdict, original restart/migration, live API/mail/cloud or diagnostic upload. See docs/STAFF_REQUEST_FENCING.md and artifacts/staff-request-checkpoint-2026-10-13.json. Task estimates: Staff & Access boundary 75%, whole staff request fencing 25% (was 15%), staff lock/recovery 65%, overall about 60% (55-65% uncertainty), goal active, not production ready. ONE next major task: migrate captured-context authority through the shared briefing request family (BriefingControls, NewBriefing, PublishForm, PublicationRecovery and related call sites), preserving exact pending IDs, old-view liveness and late-callback recovery; require corresponding headers on both backends. Other older staff helpers remain inventoried/open.

- In progress 2026-10-13 09:39 UTC, A06/S30/S42 staff-request fencing: createStaffRequest captures immutable exact authority, bounds no-store local fetch, checks pre/post transport/JSON/expiry/abort and distinguishes known denial from unknown mutation outcome. Per-view useStaffRequest binds mount generation and aborts cleanup; StaffAccess list/detail/receipt/retry use it with guarded saved-record cleanup and main refresh that never auto-adopts changed identity. Both HTTP backends now require matching context for all /api/settings/staff directory/mutation/receipt paths. Test-first missing-header regressions failed in both backends, then final combined six-file 28-pass regression and TypeScript pass. Initial integration typecheck required the explicit bounded bootstrap signal and was repaired. Full synthetic suite running, authoritative exec handle 82964, local log artifacts/staff-request-full-test-2026-10-13.log; strict build handle 46325 running. Do not restart either solely because an observation times out. Wider staff helper migration and browser/native/full-release checks remain open; no production promotion or original restart/migration.

- Actual session checkpoint pause: 30.0188 seconds, then resumed request-fencing source inspection. Shared BriefingControls.request and StaffAccess.request omit captured page context; recovery callbacks can also reach storage/refresh after asynchronous acknowledgement. Next implementation must bind each view's immutable session context and liveness before dispatch and before success/recovery cleanup, then require matching headers on the corresponding SQLite/PostgreSQL routes. Do not use a global latest-cookie/context wrapper that would adopt a changed identity into an old callback. Broader helper inventory remains in the audit; do not claim universal fencing from the staff lock alone.

- Current checkpoint, 2026-10-13: requested per-task checklist is docs/PROGRESS_BOARD.md. Staff session guard/recovery estimated 65%: actual role/scope/policy/context/expiry checks, explicit stable GET-only recovery, foreground/online/expiry/cross-tab hooks, checking-state inert workspace and localized lock/identity labels implemented. Full synthetic suite before final label/test additions: 851 tests, 847 pass, zero failed, four native skips, exit 0, 276.345s; final affected five-file regression 23 pass, exit 0. Strict 2036-module build/68 shell hashes/eight original SQLite fingerprints/integrity/FKs pass. Browser acceptance remains OPEN: Windows sandbox launcher fails with HRESULT 0x80070020, twice including reset; no workaround, external diagnostics or browser verdict. Disposable 3220 fixture stopped gracefully with zero reads/app POSTs/control calls, unchanged business/audit hashes and zero external calls. No original preview restart/migration; no preview listener was observed on 3020/3021 at this checkpoint, so existing preview availability is not claimed. Older staff helpers still omit captured-context headers and broader server fencing remains a separate 15% task. docs/STAFF_SESSION_GUARD.md records evidence and limits. Overall approximately 60% (55-65% uncertainty), goal active, not production ready.

- Actual history checkpoint pause: 30.0273 seconds, then resumed access/session source inspection. Confirmed next major A06/S42 gap: src/useWorkerSessionGuard.ts broadcasts all identity changes but attaches expiry/foreground/online/cross-tab checks and reports a lock only for workers. Authenticated staff have no equivalent global stale-session lock/recheck screen; per-route server authorization is present but does not substitute for this client/session boundary. Extend the existing session contracts conservatively to actual staff role/site/context/expiry, retain unsent/recovery state without replaying mutations, and verify revoked/expired/rotated/foreign identities plus localized recovery controls. Initial invitation/recovery and worker-entry flows already exist; do not recreate them or infer every generic invalid link is expired. All owned history sessions remain terminal; original previews untouched.

- Current checkpoint, 2026-10-12: S13/S18 now have metadata-only scoped version pages, exact-version details and number lookup in both repositories, with shared History/Languages/Responses selection and latest-only briefing DTOs. Correction: PostgreSQL had LIMIT 100; SQLite was actually unbounded. Old-version response metrics, immutable snapshots, role/session/context denial and archived content expiry are preserved. Browser checks found and repaired misleading Missing coverage on unavailable detail. Full synthetic suite 844 tests/840 passed/zero failed/four native skips, terminal 0 (236.080s), began before final UI/expiry-assertion adjustments; final affected four-file 22-pass regression and strict 2034-module build pass afterward. All 69 shell hashes/eight original fingerprints/integrity/FKs match. 125 actual synthetic publications, seven pages, retained selection, version lookup, exact v1 native tone, independent failed reads, auditor Urdu/320px and 320/390/768/1440 layouts have local evidence. Two owned built fixtures stopped gracefully with 22/9 and 9/9 catalog/detail reads, zero HTTP POSTs/unchanged briefing-publication evidence/zero external calls; tab closed, viewport reset, clipboard unused. No original restart/migration, Reticle disclosure or cloud/live/hardware operation. See docs/PUBLICATION_HISTORY.md and artifacts/publication-history-checkpoint-2026-10-12.json. Approximately 60% remains the full-production estimate, not readiness. Goal active. Next large application pass: audit S42 access/recovery states against the actual entry/invitation/recovery/session/site gates, implement confirmed missing destinations and return/retry controls while preserving exact authorization and one-use recovery; do not reimplement already working flows. Full native/live/cloud/reference/a11y/device/restore-cutoff/activation gates remain open. Protected original previews use older loaded server modules, not these fresh fixture APIs.

- Current checkpoint, 2026-10-12: S18 Text/Audio/Question/Glossary views now preserve exact selection, native/device playback boundaries, optional edit/regeneration locks and immutable-publication controls. Current-session/context/role/expiry checks fence exact text/private-URL copy; disconnected/changing views cannot initiate stale copies. Current glossary is explicitly separate from recorded dependency; scoped search/paging/override copy and term drill-down work without inventing historical terms. The built fixture exposed a real nullable-suggestion contract mismatch: valid company overrides without AI suggestions were blocked by bundle validation. Corrected without changing stored null/hash or weakening empty/invalid term checks; new positive/negative proof added. Initial keyboard markup brace and fixture's missing nextVersion were corrected before final checks. See docs/ARTIFACT_REVIEW_VIEWS.md and artifacts/artifact-review-checkpoint-2026-10-12.json. Final 157-file synthetic suite 839 tests/835 passed/zero failed/four explicit native-database skips, 256.583 seconds, terminal 0; post-fix bundle/helper 22 pass. Strict 2032-module build/61 shell hashes/eight original SQLite fingerprints/integrity/FKs pass; existing warnings remain. Built owner/auditor/immutable/copy/paging/failure/keyboard/RTL/native-tone checks and 320/390/768/1440 widths inspected. Two owned memory fixtures stopped gracefully, no HTTP POSTs/content/publication changes/external calls. Temporary tab closed/viewport reset/clipboard restored; no original preview restart/migration. Approximate full-production estimate remains 60%, not readiness. Goal active. ONE next confirmed application gap: full S13/S18 version/history catalog is capped by getBriefing's LIMIT 100 in server/postgres/read-models.mjs and the SQLite detail handler; older persisted versions cannot be reached through the current selector/timeline. Implement bounded scoped pagination and exact selected-version artifacts without unbounded full-history reads or private-data leakage. Native/cloud/live/device/a11y/full-44/restore-cutoff/activation gates remain open.

- Current checkpoint, 2026-10-12 10:03 UTC: S40.2 now has separate-operator tenant-scoped worker access metadata, literal search, complete bounded pages beyond 100, independent tenant/site/worker/link/session observations and honest retained grant-redemption time. Exact context/authority, one-statement count/page observation and strict browser projections deny foreign/malformed/private fields; failed reads and tenant switches remove stale rows. No credential, private-content, impersonation or per-worker mutation capability. Final eight-file related regression 36 passed; final full synthetic suite 156 files/831 tests/827 passed/zero failed/four explicit native-database skips, 272.456 seconds, terminal exit 0. Strict 2028-module build/66 shell hashes/eight original SQLite fingerprints/integrity/FKs pass; existing bundle/import warnings remain. Three built memory-only browser fixtures each stopped gracefully with unchanged worker/session/grant/audit/request fingerprints, zero external calls; actual 320/1440 views, search, seven-page navigation, failure recovery and foreign empty-tenant switching inspected. See docs/OPERATOR_TENANT_ACCESS.md and artifacts/operator-tenant-access-checkpoint-2026-10-12.json. All owned sessions terminal; temporary tab closed and viewport reset. Reticle verification was blocked by auto-review for possible external QA metadata disclosure; user local-only decision respected, no feedback/workaround/verdict. No original restart/migration or external service operation. Approximate full-production estimate remains 60% (55-65% uncertainty), not promotion. Goal active. ONE next confirmed application requirement: S18 Text/Audio/Question/Glossary navigation and artifact-copy controls are absent from src/LanguageArtifacts.tsx. Extend its existing exact-version/language/native-audio/edit/regeneration contracts and scoped glossary without dropping other controls, leaking private rubrics or implying live quality. Full release/reference/localization/device/a11y/native/cloud/restore/activation gates remain.

- Current checkpoint, 2026-10-12: worker access now persists only a bounded tab-local token digest before explicit redemption, then resolves uncertainty with current-session/exact-grant/current-session GETs. Both repositories enforce exact active redeemed-grant authority, no automatic redemption or logout repeat, and no token/private error disclosure. Arabic/Urdu recovery errors, reload, keyboard recheck, unaccepted-request and explicit empty new-link states have built 320px browser evidence; 1440px Urdu framing checked. See docs/WORKER_ENTRY_RECOVERY.md. Seven-file regression 25 passed; full synthetic suite 826 tests, 822 passed, zero failed, four explicit native-database skips, 251.210 seconds, terminal exit 0. Strict 2026-module build passes with existing size/import warnings. Two stale test fixtures repaired without removing preservation/provenance/cleanup assertions. Owned browser fixture verified and forcibly stopped because stdin was closed (terminal exit 1, not graceful counter proof); temporary tab closed/viewport reset. No original restart/migration or external call. Audit replaces old unaudited 70% with approximately 60% full-production estimate (55-65% uncertainty), not measured effort or readiness. AI semantic evaluation still fails; live/cloud/native/device/a11y/all-44/release gates remain open. Goal active. Next confirmed reference requirement: S40.2 scoped operator tenant access listing is absent; implement metadata-only read model and bounded console controls without impersonation/private-content access.

- Actual drafting checkpoint pause: 30.0246 seconds, then resumed SQLite/PostgreSQL worker grant and session inspection. Both redemption paths atomically consume a one-use grant and create/audit the credential session; requireSession binds the current worker to its unrevoked unexpired redeemed grant. The client catch/repeat lacks exact accepted-grant reconciliation. Next work must distinguish a current session proven to belong to the attempted grant from unrelated/stale identity, preserve generic invalid-link denial, and never automatically repeat redemption or logout an uncertain newly accepted session. No auth code changed in this inspection; all owned sessions remain terminal.

- Current checkpoint, 2026-10-12 05:50 UTC: Source/AI processing/Languages/Publish navigation connects existing drafting controls with actual state/current-source readiness, optional language inspection and region focus. Pending/edit/recovery/archive/expiry guards retained; explicit publication returns to next-draft Source. Final fifteen-file search/draft/authority regression: 70 passed, zero failed/skipped, 15.197 seconds, terminal exit 0. Strict build 2024 modules/66 shell hashes/eight original SQLite fingerprints/integrity/FKs pass; existing bundle warnings remain. Two built memory-only PGlite runs each prove one save/prepare/publish, one version/two assignments, zero attempts/external calls; both stopped. 320px overflow was fixed/replayed; 320/390/768/1440 checked. No original restart/migration, live service/cloud/hardware or Reticle verdict. Diagnostics stay local. docs/DRAFT_FLOW.md and artifacts/draft-flow-checkpoint-2026-10-12.json. Approximately 70% remains historical/unaudited. Goal active. ONE next major confirmed gap: src/main.tsx signInCredential catches uncertain worker grant redemption without reconciliation and permits another submit; when UI still has an authenticated prior identity, that repeat can logout the already-created worker session before replaying a one-use grant. Inspect both auth repositories/session issuance, add exact read-only recovery without credential leaks or automatic redemption repeat, test lost acknowledgement/current identity and retain generic invalid-link semantics. Do not restart original previews or send real data on free Gemini.
- Actual shared-search checkpoint pause: 30.0272 seconds, followed by full-scope source-flow audit and the connected drafting implementation. All owned search/draft fixture, test and build sessions are terminal. Public-shell older-tab removal/outage missing claim was stale; docs/WORKER_OFFLINE.md already records its repair. Different-build updates/physical offline/capture/reconnect remain open.

- Current application checkpoint, 2026-10-12 05:36 UTC: shared header staff search now queries scoped briefing titles/worker references/crew names on both repositories, with literal bounded queries, complete counts, 20-row pages, actual role/site/tenant authority and current context. No private content search. Exact worker/crew routes open authoritative existing detail/membership controls. Seven-file regression 36 passed/zero failed/skipped (11.272 seconds); initial six sandbox loopback failures resolved by authorized disposable rerun. Strict build 2022 modules/65 shell hashes/eight original SQLite fingerprints/integrity/FKs pass. Built synthetic desktop/mobile owner/auditor, paging, Arabic wrapping and exact destinations/reloads checked. Both accounted fixtures stopped with zero writes/unchanged business/zero external calls. No original preview restart/migration or live/cloud operation. Reticle unconnected; diagnostics kept local by user. See docs/STAFF_SEARCH.md and artifacts/staff-search-checkpoint-2026-10-12.json. Approximately 70% remains historical/unaudited, not production readiness. Goal active; resume full-scope major requirement audit after an actual 30-second checkpoint pause.

- Current checkpoint, 2026-10-12 04:47 UTC: production retention requires the authenticated exact quarantine/replay/cleanup predecessor. Existing seventeen cleanup stages plus final audit now account real transaction boundaries under full-table/migration locks, flush deferred constraints, constrain changed tables/nonmutable input columns, and file-sync encrypted successor before commit. Migration 083 retains actual per-site cleanup transition receipts before activity identity expiry. Private removals require exact retired family/scope/hash/size, encrypted pre-removal intent, fresh absence and unchanged database; witnessed absence is rechecked on resume. Uncertain commit/persistence/removal, retained objects, drift and resurrected bytes stop further stages without claiming physical rollback.
- Source inputs are checked before initial cleanup and its exact backup/target/ledger admission is retained. Resume keeps raw source gaps visible and accounts only known text/transcript/object changes under the same admitted ledger and guarded exact successor. Missing/changed input identities, clocks, ordering, scope, different admissions and other conflicts remain blocked. Late privacy replay after cleanup rejects before mutation; complete cross-phase reconciliation and automated incomplete-intent/full-chain recovery are still required, not silently narrowed away. See docs/RESTORE_CLEANUP_ACCOUNTING.md.
- Broad fifteen-file regression: 89 passed, zero failed/skipped, 85.703 seconds, terminal exit 0. After final evidence-bound/admission/phase checks, affected three-file regression: 39 passed, zero failed/skipped, 69.711 seconds; newest cross-phase/invalid-admission/chain assertion one passed, 13.301 seconds. Earlier migration/sweep 26 passed and archived/activity/deletion focused one passed. Strict build (2019 modules, existing chunk/import warnings), 63 shell hashes and eight original SQLite fingerprints/integrity/FKs pass. All owned sessions terminal; no original migration/restart, external provider/mail/account/cloud/native/deployment operation or browser verdict. Embedded physical sequence restart drift (2 to 33) exposed by exact quarantine remains rejected in production; the fixture explicitly emulates authored logical restore setval before exact comparison. Stale migration expectations and overly specific error assertions were corrected, not counted green before rerun. artifacts/cleanup-state-checkpoint-2026-10-12.json preserves evidence.
- Approximately 70% remains historical/unaudited, not measured readiness. The next pass will re-audit full specification/reference coverage and identify the highest-impact remaining application and release work, alongside recovery chain/cutoff authority. Native Neon Free/roles/TLS/concurrency/storage/restore, privacy-approved live AI, full reference/device/a11y/security, fresh install/CI/release and separately authorized activation remain open. Goal active; older next-task entries are historical.
- Actual cleanup checkpoint pause: 30.0289 seconds, then resumed complete specification/reference/feature-gate inspection. Existing register/readiness tables contain historical missing-feature claims that must be rechecked against current code; neither their old 70% estimate nor narrow passing recovery tests prove full coverage or readiness. All owned test/build sessions are terminal.
- Resume finding: S09 microphone capture is already implemented in `src/SourceAudio.tsx` and wired through `src/NewBriefing.tsx`; the register's old missing-microphone claim was stale and corrected without reimplementing it. Native hardware/full source-stepper/reference coverage remains unverified. ONE next task: inspect the remaining complete spec and current S01-S44/A01-A18 code/test/reference contracts, replace stale missing claims with evidence-backed gaps, and implement the highest-impact confirmed application gap. Work in D:\understod; no original preview migration/restart or live service operation is implied by this audit.

- Current checkpoint, 2026-10-11 21:43 UTC (12 October local): all six production privacy replay commands require an authenticated exact predecessor bound to backup/target. Full-table/migration locks guard before/after inventories; immediate deferred constraints expose out-of-set effects. Definitions/sequences/table identity and unrelated rows cannot change; private references cannot rebound/resurrect and retirement needs source authority. Encrypted successor is file-synced before commit, then the existing acknowledgement follows commit. Candidate reuse requires exact inventory and complete committed per-site operational receipts; stale, rolled-back, drifted, wrong-purpose or target checkpoints reject. No legacy snapshot backfill or activation.
- Final split eleven-file regression: nine recovery files 67 passed/zero failed/skipped (78.710 seconds), authorized disposable hosted/runtime two files seven passed/zero failed/skipped (2.886 seconds). Focused new state-chain tests three passed (13.223 seconds); earlier related 32 passed. A commit-failure fixture initially failed during migration verification and was corrected to arm only after the replay's constraint flush; final pending-state rollback/lost-ack checks pass. Strict build (2019 modules, existing chunk/import warnings), 63 shell hashes and eight original SQLite fingerprints/integrity/FKs pass. All owned sessions terminal. No new migration, original preview restart, external provider/mail/account/cloud/deployment/native operation or browser verdict. See docs/RESTORE_STATE_ACCOUNTING.md and artifacts/privacy-replay-state-checkpoint-2026-10-12.json.
- Approximately 70% remains a historical unaudited estimate, not readiness. Next: stage-specific exact state accounting for irreversible physical cleanup, without pretending transaction rollback restores removed bytes. Source maintenance/storage authority, native Neon Free/roles/TLS/concurrency/restore/storage, full reference/device/a11y/security/release and separately authorized activation remain open. Goal active; older next-task entries are historical.
- Actual replay-state checkpoint pause: 30.0476 seconds, then resumed cleanup sweep inventory. Seventeen independent stage tasks include transactions and irreversible external byte removals; an outer transaction cannot provide honest physical rollback. Stage-specific durable intentions/receipts and exact state succession must cover incomplete removal and failure, not merely snapshot the current target after arbitrary work.

- Current checkpoint, 2026-10-11 21:28 UTC (12 October local): production restore now rechecks the authenticated exact baseline under full-table/migration locks inside quarantine, forces deferred constraints, and rejects changes outside the declared quarantine table set, including unrelated future/quoted tables, sequence/guard changes and private-reference changes. Actual post-quarantine full inventory/clock is captured before commit. After private copying/readback, target inventory must still match. A separate target/backup-bound authenticated quarantine-state.enc and aggregate result digest preserve the initial controlled transition; neither authorizes release.
- Final eleven-file regression: 71 passed, zero failed/skipped, 67.801 seconds, terminal exit 0; focused eighteen and earlier backup seven pass. Tests demonstrate between-check drift rejection, deferred out-of-set side-effect rollback and physical embedded archive checkpoint/purpose/target/hash round trip. Final strict build/63 shell hashes/eight original SQLite fingerprints/integrity/FKs pass with existing build warnings. No new migration, original preview restart, external provider/mail/account/cloud/deployment/native operation or browser verdict. See docs/RESTORE_STATE_ACCOUNTING.md and artifacts/quarantine-state-checkpoint-2026-10-12.json.
- Approximately 70% remains a historical unaudited estimate, not readiness. Initial quarantine accounting is now implemented; exact predecessor/successor state accounting for subsequent privacy replay/physical cleanup, durable recovery/cutoff authority and separately authorized release remain. Native Neon Free/roles/TLS/concurrency/storage/restore, complete reference/device/a11y/security/release and expired-history browser gates remain open. Goal active; earlier next-task entries are historical.
- Actual prior runtime-fence checkpoint pause: 30.0309 seconds, then resumed target-state inspection and implementation. All owned test/build sessions are terminal.
- Actual quarantine-state checkpoint pause: 30.0405 seconds, then resumed privacy replay/cleanup state-chain inspection. Existing replay locks all schema tables and binds immutable original-source/audit evidence, but does not yet require the authenticated exact predecessor or capture a durable whole-state successor. Cleanup has irreversible private removals across transactions; do not wrap it in a speculative rollback that would falsely promise physical restoration. Next work must preserve honest retry/acknowledgement and quarantine, without inventing state history or activation.

- Current checkpoint, 2026-10-11 21:22 UTC (12 October local): explicit restricted PostgreSQL service-role setup/check commands now separate hosted API/worker/check from migration-owner authority. Roles with memberships, privileged attributes, owned objects, unexpected table/column/default/grant authority or executable definer routines are denied. An explicit table allowlist keeps normal typed acceptance functional but denies DDL, trigger control, truncation, sequence rewrites, restore/import/bootstrap journal mutation and unknown/future tables. No automatic future grants. Hosted HTTP login/overview/logout now runs under the actual restricted fixture role; worker startup rejects unsafe/fenced roles before dispatch.
- Persistent source ACL fencing now admits every explicitly listed runtime role under existing full-table backup/shutdown/lease locks and atomically revokes schema writes and sequence advancement. Source business inventory remains exact; multi-role fences block real typed acceptance and worker mutations after commit. Optional source-cutoff runtime-role checks run before/after private verification and bind the live result to the encrypted authenticated backup/source observation. Maintenance/storage authority and omitted identities are not certified; sourceCutoffEstablished/activationAllowed/productionReady remain false.
- Final eleven-file regression: 70 passed, zero failed/skipped, 65.962 seconds, terminal exit 0. Earlier 23-test regressions, final focused ten/five and authorized hosted six passed. Initial fixture assumptions about receipt clock, session authorization reset and GRANT errors were corrected with intact behavioral checks; one hosted read-only assertion matched SQL privilege literals and was corrected to statement starts. Sandbox loopback EACCES was not green; disposable authorized rerun passes. Final strict build passes (2019 modules, existing chunk/import warnings), all 63 shell hashes and eight original SQLite fingerprints/integrity/FKs pass. No original migration/restart, external provider/mail/account/cloud/deployment/native operation or browser verdict. See docs/RUNTIME_PERMISSIONS.md and artifacts/runtime-fence-checkpoint-2026-10-12.json.
- Approximately 70% remains the historical unaudited estimate, not a readiness promotion. Next major work: exact target-state accounting for authorized quarantine/cleanup and durable backup-bound release evidence, without enabling access. Native Neon Free/roles/TLS/concurrency/storage/restore, complete reference/device/a11y/security and release gates remain open. Goal active. Prior next-task entries are historical.
- Prior source-cutoff checkpoint pause was actually 30.0368 seconds, then resumed restricted service-role/source-fence implementation. All owned test/build sessions are now terminal.

- Current checkpoint, 2026-10-11 20:59 UTC: complete source-snapshot comparison now checks every table/count/hash, precise sequence/called flag, guard definition and known private reference against the authenticated backup, independently of submission coverage. V7 ledger validation requires the full inventory contract; privacy plans expose encrypted sourceSnapshot differences with aggregate-only stdout. New postgres-cutoff command verifies encrypted backup checksums and actual source retained-byte hash/size plus non-retained absence while the source snapshot stays locked. It emits a purpose-bound encrypted observation and v7 ledger, never writes source business state or activates access.
- Final eight-file recovery regression: 57 passed, zero failed/skipped, 62.475 seconds, terminal exit 0. Earlier combined 57 and focused 14/four checks also pass. Physical embedded restore test demonstrates zero accepted-input gaps while a later unrelated table/large precise sequence change still invalidates full source matching. Missing/corrupt retained bytes, unknown retired absence, source mismatch, wrong encrypted purpose, corrupt archive and output overwrite reject or remain non-candidates. Strict build passes (2019 modules, existing chunk/import warnings), 63 shell hashes and eight original SQLite fingerprints/integrity/FKs pass. No new migration, original preview restart, external provider/mail/account/cloud/deployment operation, native utility execution or browser pass. See docs/SOURCE_CUTOFF.md and artifacts/source-cutoff-checkpoint-2026-10-11.json.
- Approximately 70% remains a historical unaudited estimate, not readiness. This is a point-in-time cutoff candidate only: sourceCutoffEstablished/activationAllowed/productionReady remain false. Next major work is a durable source write fence and exact target-state accounting across quarantine/cleanup before separately authorized release. Source must remain stopped; native/Neon/private-storage/concurrency, complete reference/device/a11y/security/release and expired-history browser gates remain open. Goal active; prior next-task entries below are historical.

- Current checkpoint, 2026-10-11 20:41 UTC: privacy ledger v7 adds original exact typed/audio receipt order/scope/kind/time and hash-only answer/result/transcript evidence. Fifteen input/version/audience/case families and retained private objects are compared in both directions. Missing later inputs, accepted staging clocks, changed evidence and unbound source receipts remain explicit. Recovery uses a fresh full stopped-source DB/object capture, never manufactured acceptance/history. Production retention CLI now requires the encrypted source ledger and blocks all destructive cleanup before cycle one on gaps/conflicts or missing/corrupt retained bytes; detailed identities remain encrypted, stdout is aggregate-only.
- Final seven-file recovery regression: 53 passed, zero failed/skipped, 61.328 seconds, terminal exit 0. Final focused three tests also passed before the combined rerun. Initial 30-test run had one fixture readback missing required hash/size and failed the real private-storage integrity guard; fixed with the actual ledger object reference, no assertion weakened. Strict build passes (2019 modules, existing chunk/import warnings); all 63 shell hashes and all eight original SQLite business fingerprints/integrity/FKs pass. No new migration, original preview restart, external API/mail/account/cloud/deployment operation or browser pass claimed. See docs/RESTORE_ACCEPTED_INPUTS.md and artifacts/accepted-input-restore-checkpoint-2026-10-11.json.
- Approximately 70% remains the historical unaudited estimate, not verified production readiness. Accepted-input comparison and safe recapture path now guard cleanup; final source cutoff/full business-state parity/separately authorized activation, native/Neon/private-storage/concurrency and complete reference/device/a11y/security/release gates remain open. Goal active. Next major work: final stopped-source cutoff/release evidence, without reactivating any target. Prior next-task entries below are historical.
- Actual checkpoint pause: 30.0345 seconds, then resumed complete source-inventory/cutoff inspection. Existing databaseInventory covers every discovered table (including future/quoted tables), sequence state and guard definitions; backup/ledger already bind source identity and objects. Next cutoff comparison must use that full inventory, not only fifteen input projections, and distinguish original-source parity from authorized quarantine/cleanup target changes. All owned test/build sessions are terminal. No activation/external operation or browser pass claimed.

- Current checkpoint, 2026-10-11 20:24 UTC: migration 082/privacy-ledger v6 implement confirmed historical briefing-content replay in full quarantine, binding all target projections/immutable lineage to original source proof. Separate fresh target purge/redaction and immutable root journal survive a second backup; current policy/version/outcome/archive/case clocks remain unchanged. Fresh generated cleanup receipts are required. Application/SQL expired-admission fences and worker history DTO/UI now distinguish content availability from publication state. SQLite inbox first-time conversation schema setup no longer nests a transaction.
- Final combined regression: 103 passed, zero failed/skipped, 72.678 seconds, terminal exit 0. Strict production build passes; 63 shell hashes and eight original SQLite fingerprints/integrity/FKs pass. Prior runs exposed three sandbox-only loopback denials, one incomplete acceptance-receipt fixture assertion and two SQLite nested-transaction failures; all addressed with intact assertions. Reticle has no connected session; browser fixture navigation timed out/was client-blocked, so no browser pass. Disposable fixtures stopped; no original migration/restart/external provider/mail/account/deployment operation. See docs/BRIEFING_RESTORE.md and artifacts/briefing-restore-checkpoint-2026-10-11.json.
- Approximately 70% remains a historical unaudited estimate, not a production-readiness promotion. Next major work: source-authoritative accepted-input/staging lifecycle reconciliation and final source cutoff before separately authorized activation. Native/Neon/private-storage/concurrency, full reference/device/a11y/security/release and expired-history browser verification remain. Goal active; older next-task entries are historical.
- Actual checkpoint pause: 30.0272 seconds, then resumed accepted-input/staging ledger and restore inventory inspection. All owned tests/build/fixtures are terminal. No external operation, original preview change, activation or browser pass claimed.

- Current checkpoint, 2026-10-11 19:50 UTC: migration 081 captures immutable original briefing-expiry context/policy/receipt inside the actual purge before redaction. Eight original hash groups, archive author/time/closed versions, minimal accepted response/case metadata and actual generated removal evidence remain without copying private content. Missing/ambiguous policy authority, retrospective capture/backfill and backdated/future completion are denied. Privacy-ledger v5 validates this provenance and exact target projections; an unchanged older publication may differ from the erased source only through its original hash, while changed review/extra target copies fail closed. Read-only planning never closes versions/cases or erases the target.
- Final related suite: 56 checks, 55 passed, zero failed, one explicit native PostgreSQL prerequisite skip, 55.520 seconds, terminal exit 0. Earlier focused run: 21 passed; intermediate added assertion run: 23 passed/one Date-to-string millisecond assertion failure, corrected with full-resolution comparison. Final strict build, 63 shell hashes and all eight original SQLite fingerprints/integrity/FKs pass. Reticle has no connected browser; no browser pass claimed. No original migration/restart, external provider/mail/account operation or deployment. See docs/BRIEFING_EXPIRY_PROVENANCE.md and artifacts/briefing-expiry-origin-checkpoint-2026-10-11.json.
- Approximately 70% remains the historical unaudited estimate, not a readiness promotion. Next major task: apply original-source briefing redaction atomically in quarantine, retaining root archive/expiry/case provenance across later backups, requiring fresh target generated cleanup and fencing expired worker admissions without rewriting versions/outcomes. Accepted-input/final-cutoff/activation, native/cloud and full release gates remain. Goal active; earlier next-task statements below are historical.
- Actual checkpoint pause: 30.0308 seconds, then resumed existing source-case retirement/root-proof/quarantine and worker response/read-model inspection. Fresh target content receipts must remain distinct from original root authority; later backups must retain the root record rather than recreate source clocks. All owned tests/build are terminal, no browser pass or external operation claimed.

- Current checkpoint, 2026-10-11 19:29 UTC: migration 079 implements confirmed default-disabled archived-briefing content retention, eight-copy physical redaction with preserved version/audience/outcome evidence, exact hash-backed command recovery, expired history and quarantined maintenance sweep. Built desktop lost-ack/reload and 320px disable/history checked. Migration 080/privacy-ledger v4 add all six source policy decisions, visible pending briefing/activity redactions, and atomic historical activity replay retaining root source proof across a second backup. Exact proven replay acknowledgement remains read-only even after later target conflicts; fresh operations still reject conflicts.
- Final related suite: 57 checks, 56 passed, zero failed, one explicit native PostgreSQL prerequisite skip, 51.786 seconds, terminal exit 0. Focused briefing/HTTP/review/restore run: 21 passed. Strict build, 63 shell hashes and all eight original SQLite business fingerprints/integrity/FKs pass. Initial fixture/JSON equality failures, sandbox loopback denial, migration-edit race, outdated migration expectation and later-policy exact-receipt recovery conflict were addressed openly; final assertions remain intact. See docs/BRIEFING_CONTENT_RETENTION.md, docs/PRIVACY_LEDGER.md and artifacts/briefing-activity-restore-checkpoint-2026-10-11.json.
- Approximately 70% remains the historical unaudited estimate, not a production-readiness promotion. Next major task: original-source historical briefing-content replay, with matching content proofs and preserved archive/case/accepted-input lineage. Current generated cleanup prerequisite is explicit. Accepted-input/final source cutoff/activation, native/cloud/concurrency, all reference/device/a11y/security and complete release gates remain open. Every restore remains quarantined/activation-forbidden. No original preview restart/migration, external API/mail/account operation or deployment. Goal active; older next-task entries below are historical.
- Actual checkpoint pause earlier this session: 30.0284 seconds, then resumed six-policy ledger and activity replay implementation. Owned test/build processes are terminal. Disposable browser fixture process confirmed absent after its timeout; final shutdown counters were not retrieved across the environment transition. Original data retained. Reticle had no connected session; no Reticle pass claimed.
- Second actual pause: 30.0460 seconds, then resumed historical briefing replay inventory. Archive receipts preserve original scoped author/time and exact closed publication IDs; archives leave accepted evidence intact. An older target may still be published or lack later honest case closure. Next implementation must bind all eight original content projections and retain source archive/case provenance in quarantine, requiring fresh generated-byte absence rather than importing source cleanup success. No version/outcome clocks may be fabricated. Existing hash conflicts remain fail-closed meanwhile.

- Current checkpoint, 2026-10-11 16:28 UTC: migration 078 separates mandatory worker-disable/credential-recovery/restore receipts from expiring display identifiers. Original exact backfill/atomic capture/equality guards/immutable receipt and pre-expiry proof guard; application+SQL quarantine, source access ledger and exact replay lookup use retained provenance. Related regression: 44 passed, zero failed/skipped, 161.299 seconds; upgrade one passed (2.252 seconds), final restriction suite eight passed (36.859 seconds), all terminal. Original data/build/hash checks pass. No original migration/restart/external call or activation. See docs/OPERATIONAL_PROVENANCE.md and its artifact.
- Approximately 70% remains historical/unaudited, not production readiness. Activity policy/historical redaction source reconciliation still open, but mandatory access/quarantine provenance prerequisite is now implemented. Next major application task: briefing-content retention preserving versions/outcomes/minimal provenance and fencing pending work. Native/cloud/full reference/device/a11y/security/release and final activation remain. Goal active.
- Actual checkpoint pause: 30.0299 seconds, then resumed archived briefing-content inventory. Archive currently closes new work but preserves source/prepared/publication copies and allows accepted pending assessment; expiry must account for that evidence before redaction. All owned tests/fixtures are terminal, original data preserved.

- Current checkpoint, 2026-10-11 16:15 UTC: S36/S37/A16 default-disabled activity identity retention implemented in credential PostgreSQL settings/API/worker/restore sweep. Exact confirmed policy receipts, locked scheduled physical actor/item redaction, deferred truthful completion, preserved minimal event evidence and denial of edits/deletion/restoration. Read/search/detail/CSV show expired identities. Related regression: 51 passed, zero failed/skipped, 135.765 seconds; earlier activity/recovery six passed. Built desktop/lost-ack/reload/320px disable and expired history/detail verified. Fixture terminal: two POSTs/two receipts/revision 2 disabled/one redaction/zero external calls. Strict build/63 shell hashes and original eight SQLite hashes/integrity/FKs pass. See docs/ACTIVITY_RETENTION.md and its checkpoint artifact.
- Approximately 70% remains the historical unaudited estimate, not a readiness promotion. Full briefing-content retention and later source-authoritative activity privacy reconciliation remain unfinished; minimal audit metadata/other operational ledgers have separate lifecycles. Every restored target remains quarantine/activation-forbidden. Native/cloud/full release gates remain. No original DB migration, preview restart, external call or production-ready claim. Goal active; earlier next-task statements are historical.
- Additional full backup/domain/embedded/recovery rerun: 55 passed, zero failed/skipped, 107.803 seconds. Earlier 54/one-failure run identified the explicit migration test list stopping at 072; expected 073-077 added, all invariant assertions retained. Current worker/restore inspection identifies a prerequisite before activity restore reconciliation: mandatory access/quarantine provenance must survive separately from expired activity identifiers.
- Actual checkpoint pause: 30.0222 seconds, then resumed mandatory recovery/access provenance inspection. Goal remains active; no production-readiness claim.

- Current checkpoint, 2026-10-11 15:55 UTC: S34 credential PostgreSQL usage now exposes actual organization UTC request-slot allowance/reset/journal counts and coarse closed/paused/exhausted state without private or cross-tenant ledger leakage. Confirmed plan/quota/contact requests have immutable records, atomic audit, exact author-scoped receipts, scoped tab recovery and a paged site-owner inbox. No purchase, automatic quota edit or email claim. Final focused regression: 14 passed, zero failed/skipped, 11.171 seconds; strict build/63 shell hashes and all eight original SQLite fingerprints/integrity/FKs pass. Built desktop/320px submit/inbox/reload journeys verified; final fixture one POST/one request, zero external calls. See docs/PLAN_USAGE.md and artifacts/usage-checkpoint-2026-10-11.json.
- Approximately 70% remains only the historical unaudited estimate, not a readiness promotion. Costs/entitlements remain unknown/illustrative; request resolution/delivery, native/cloud/concurrency/full release and recovery activation remain unproved. Next large application gap: broader S36/A16 briefing/activity content retention, preserving immutable versions and minimal audit evidence. Existing preview/data are not migrated or restarted. Goal active; earlier next-task entries below are historical.
- Actual checkpoint pause: 30.022 seconds, then resumed broader briefing/activity retention inspection. No activation or production-readiness claim.

- Current checkpoint, 2026-10-11 15:32 UTC: S16/A15 crew-at-publication and latest-response civil-date filters now share immutable export filters, rows and captured time zone. New publication audience is frozen; old versions do not invent historical crew membership. Desktop filter/export and 320px no-crew/clear journeys are verified against an isolated built synthetic fixture. Populated SQLite-to-PostgreSQL cutover preserves audience, exact request and CSV output. Final combined regression: 79 passed, zero failed/skipped, 293.825 seconds, terminal exit 0. See docs/REPORT_SCOPES.md and artifacts/report-scopes-checkpoint-2026-10-11.json for actual results, intermediate failures and limitations.
- Strict build/63 shell hashes and all eight original SQLite business fingerprints/integrity/FKs pass. Existing warnings remain. Browser download-event verification stalled/reset and is not a pass; server download evidence is separate. No original migration/preview restart/external provider/mail/deployment. Approximately 70% remains only the historical unaudited estimate, not a production-readiness promotion. Next large application requirement: S34 connect actual configured quota/pause usage without fake entitlements or costs. Native/cloud/recovery activation/full release gates remain open. Goal active; older next-task entries are historical.
- Actual checkpoint pause: 30.0311 seconds, then resumed S34 inspection. PostgreSQL operator policies already enforce default-closed global/organization UTC request-slot quotas; customer usage currently omits them. Next changes expose only the authorized organization's aggregate allowance and coarse global availability, never other tenants' usage or raw provider configuration.

- Updated (UTC): 2026-10-11 14:14, restore access restriction checkpoint. Migration 074 and privacy ledger v3 preserve original staff/site/tenant decisions separately from target maintenance fences. Restore disables credential accounts/operators; replay never re-enables access or copies secrets. Six new checks and related regression: 36 passed, zero failed/skipped, 32.421 seconds. Strict build/63 shell hashes and all eight original SQLite business hashes/integrity/FKs pass. Fixture errors were corrected: required reasons_json, expectedCode input and timestamp representation. Existing build warnings remain. Native/cloud/full activation are not proved.
- Prior status-only response was no implementation progress; resumed verification is concrete progress. Approximately 70% is only the historical unaudited estimate. Next application requirement: response-time/crew report filtering with matching immutable export snapshots. Saved draft language editing is already implemented in DraftLanguages.tsx and draft-languages modules; older register gap is not current. Accepted-input recovery/final cutoff/activation and other release gates remain open. No preview restart, original database migration, external call or deployment.

- Updated (UTC): 2026-10-11 11:09, historical privacy-retirement checkpoint. Migration 073 adds immutable original-input/receipt/policy provenance and full-quarantine SQL guards. The maintenance-only encrypted retirements command replays earlier text/case/generated retirement and queues fresh recording/source/follow-up/voice cleanup even after current policies are extended or disabled. Original outcomes/publications/assignments and honest case clocks remain unchanged; source success is not copied as target physical absence. A later backup of a quarantined restore retains original case-resolution provenance. See docs/PRIVACY_LEDGER.md and artifacts/restore-privacy-retirements-checkpoint-2026-10-11.json.
- Final related regression: 121 checks, 120 passed, zero failed, one explicit native PostgreSQL prerequisite skip, 79.652 seconds. Initial sandbox run had six loopback EACCES failures and was not green; authorized disposable-loopback rerun passes. Initial new fixture mistakes (original-object existence namespace and invalid disabled audio policy) were corrected, not hidden. Real owned local synthetic files cover all six source/target families; failed deletion cannot complete the target. Strict build/63 shell hashes and eight original SQLite business fingerprints/integrity/FKs pass; existing size/offline-import warnings remain. No original DB migration/preview restart/cloud/provider/mail/real-data/native-database/UI/hardware or production-readiness claim.
- Approximately 70% remains the historical unaudited implementation estimate, not a readiness promotion. ONE next major task: source-authoritative later staff/worker/site/tenant access restriction reconciliation while quarantine remains intact. Accepted-input/staging lineage after backup, final source cutoff/activation, broader activity/briefing retention and native/cloud/UI/device/security/full release gates remain unfinished. Every result keeps reconciliation incomplete and activation forbidden. Goal active; earlier next-task entries are historical.
- Actual checkpoint pause: 30.0286 seconds, then resumed staff/worker/site restriction inspection. Staff changes have immutable scoped request/revision receipts; worker disable revokes grants/sessions with scoped audit. Tenant restore quarantine independently increments its revision, so original source restrictions need separate provenance without replacing suspension or restoring sessions. No activation performed.

- Updated (UTC): 2026-10-11 10:31, source-authoritative privacy decision checkpoint. Added encrypted original-source ledger export, read-only restored comparison and atomic original worker-deletion/current-four-policy replay. Matching scoped identities, migration/guard definitions and quarantine are rechecked under all-table locks. Original actors/IDs/fingerprints/payloads/times survive; missing actors become disabled placeholders without credentials or sessions. Original purge/redaction/completion claims are not copied. Exact replay is audited, ledger-bound and write-free; failed audit rolls back the whole operation. See docs/PRIVACY_LEDGER.md and artifacts/privacy-ledger-checkpoint-2026-10-11.json.
- Final related regression: 93 checks, 92 passed, zero failed, one explicit native PostgreSQL prerequisite skip, 90.916 seconds. Initial sandbox run had 16 loopback EACCES failures and was not green; authorized disposable-loopback rerun passes. One earlier test compared the same timestamp in two time zones; its fixture query now uses UTC, with original timestamps preserved. Strict build/63 shell hashes and eight original SQLite hashes/integrity/FKs pass. Existing bundle/offline-import warnings remain. No original DB migration/preview restart/cloud/provider/mail/real-data operation or production-readiness claim.
- Approximately 70% remains the historical unaudited implementation estimate, not a readiness promotion. ONE next major task: source-authoritative historical retirement/redaction reconciliation, including earlier shorter policies and original case-resolution evidence, without weakening immutable guards. Later access restrictions/final source cutoff and activation gate, broader retention, native/cloud/UI/device/security/full release gates remain unfinished. Every new result keeps authoritative reconciliation incomplete and activation forbidden. Goal active; no repeated Resume needed. Earlier next-task entries are historical.
- Actual checkpoint pause: 30.0311 seconds, then resumed migrations 071/072 guard inspection. Historical case cleanup requires the original honest resolution clock/recent-content evidence; generated retirement requires its exact historical policy and attached artifact identity. Current policy replay alone cannot reconcile earlier erasure. No guard bypass or activation performed.

- Updated (UTC): 2026-10-11 09:51, isolated restored-retention checkpoint. Recording purge now requires strict physical absence and a live owned lease on SQLite/PostgreSQL; PostgreSQL interrupted staging has the same guard. A bounded maintenance sweep runs existing elapsed-policy and worker-deletion jobs without AI/mail/publication/access dispatch. All-table locked final inspection counts deferred retries/active leases, verifies all retired references absent and all retained references intact. Encrypted backup-bound CLI results always keep authoritative post-backup reconciliation required and activation forbidden. See docs/RESTORE_RETENTION.md and artifacts/restore-retention-checkpoint-2026-10-11.json.
- Final focused regression: 83 checks, 82 passed, zero failed, one explicit native PostgreSQL skip, 85.274 seconds. Initial sandbox run had 16 loopback EACCES failures, not green; authorized disposable-loopback rerun passes. Two earlier restore fixture mistakes were corrected, not hidden. Strict build and 63 shell hashes pass with existing size/offline-import warnings. Eight original SQLite hashes match, integrity OK/FKs zero. No original DB migration/preview restart/cloud/provider/mail/real-data operation, UI/browser/hardware or production-readiness claim.
- Approximately 70% remains a historical unaudited estimate. ONE next major task: authoritative post-backup privacy ledger export/import/reconciliation for later deletion/revocation, changed policies and already-retired/redacted evidence. The elapsed sweep alone cannot know those events and must not release a restore. Broader retention/native database/cloud/full release gates remain. Goal active; no repeated Resume required. Earlier next-task entries are historical.
- Actual checkpoint pause: 30.0261 seconds, then resumed source-authoritative deletion/retirement inspection. Existing deletion acceptance requires a real scoped actor and generated retirement requires its exact policy; later-event reconciliation must preserve that evidence rather than fabricate sessions, reinterpret authorship or bypass guards. No activation or readiness promotion.

- Updated (UTC): 2026-10-11 09:28, PostgreSQL/private-object recovery checkpoint. Added encrypted native custom-schema archive orchestration with synchronized snapshot/table locks, full discovered table/sequence/constraint/trigger/function inventory, exact six-family object coverage and an encrypted completion manifest. New isolated-target restore authenticates the archive, verifies full relational inventory, atomically revokes access/links/mail and quarantines tenants/provider/jobs before private-object readback. Retired objects must remain absent; missing/corrupt/interrupted copies never produce a success result. Existing immutable evidence and saved preview data remain unchanged. See docs/POSTGRES_BACKUP.md and artifacts/postgres-backup-checkpoint-2026-10-11.json.
- Focused backup/storage/source/invitation regression: 55 checks, 54 passed, zero failed, one explicit native PostgreSQL skip, 46.166 seconds. Initial sandbox run had two loopback EACCES failures (not green); rerun with authorized local fixture connectivity passes. Physical PGlite archive/object round trip verifies all six families and interruption quarantine; it is not native pg_dump/Neon/R2/concurrency proof. Strict optimized build and all 63 shell hashes pass with existing warnings. Eight original SQLite business hashes match, integrity OK, FKs zero. No cloud/provider/mail/real-data or existing-preview operation.
- Approximately 70% remains the historical unaudited estimate, not a readiness promotion. ONE next major task: executable restored-privacy reconciliation for elapsed policies and authoritative post-backup privacy requests, preserving quarantine until verified. Native utility/database restore, broader activity/briefing retention, deployment and full release gates remain. Goal active; no repeated Resume required.
- Actual checkpoint pause: 30.0211 seconds, then resumed inspection of elapsed-policy/deletion completion. PostgreSQL recording purge currently commits completion after removal acknowledgement without its own physical absence check; tighten that path before using it for restore privacy reconciliation. Existing deletion completion independently verifies absence. No new readiness claim.

- Updated (UTC): 2026-10-11 05:50, generated briefing audio retention checkpoint. Migration 072 adds a separate confirmed/default-disabled policy, exact scoped receipts and immutable retirement/removal journals. Scheduled retirement fences playback/publishing before retryable deletion; verified object absence and atomic audit are required for completion. Published snapshots/text/outcomes/provenance remain unchanged. Built desktop/lost-ack/reload and 320px normal-save/disable journeys exercised; a long-command overflow was fixed and verified (267/267 section, 305px page at 320px viewport). Both fixtures terminal at two POSTs/two receipts/revision 2/disabled and zero external requests. See docs/GENERATED_AUDIO_RETENTION.md and its artifact.
- Focused generated/pipeline suite: 49 passed, zero failed/skipped, 55.856 seconds. Later cutover/runtime/case/text/recovery: 24 passed, zero failed/skipped, 13.972 seconds; initial missing-recording-schema fixture corrected, not counted green. Import emptiness now locks/checks all current schema tables, including future ledgers, with migration serialization and server-quoted identifiers. Strict build/63 shell hashes pass; existing warnings remain. Eight original SQLite business hashes match/integrity OK/FKs zero; no existing migration/policy/live/provider/cloud/real-data operation. Actual 30.0305-second pause then implementation resumed.
- Approximately 70% remains the historical unaudited estimate, not readiness promotion. ONE next concrete major task: full PostgreSQL relational plus private-object backup/isolated restore workflow and cleanup-state reconciliation. Broader activity/briefing retention, concurrency, cloud, all-reference/a11y and release gates remain. Goal active; no repeated Resume needed.

- Updated (UTC): 2026-10-11 05:40, resolved-case retention checkpoint. Migration 071 adds a separate confirmed/default-disabled policy, exact actor/site receipts, an honest resolution clock and atomic redaction of expired resolved-case text. Open/recent/foreign cases and immutable outcomes/provenance survive; voice cleanup remains retryable and new reviews are fenced after expiry. Related suite: 52 passed (20.135 seconds); latest read-model/review checks: 13 passed (8.156 seconds), resolving a sandbox-only loopback failure. Pipeline/audio/embedded checks: eight passed. Strict build passes with existing warnings.
- Disposable built-browser verification covers response and case policy recovery, explicit disable and desktop/320px layout. Response fixture: two POSTs/two receipts; case fixture: three POSTs/two receipts because Chromium replayed an uncertain POST, with exact replay preventing a third policy revision. Both fixtures stopped, owner signed out, QA tabs closed. No live/cloud/provider/real-data verdict. See docs/CASE_RETENTION.md. Approximately 70% remains a historical unaudited estimate, not production readiness. Next major task: generated briefing audio retention and verified physical absence; broader retention/restore/full release gates remain. Goal active.

- Updated (UTC): 2026-10-11 05:22, response-text settings implemented and browser exercised. Confirmed separate PostgreSQL control, exact scoped tab recovery, blocked unknown outcomes and receipt-only reload recovery exist. Eight focused text/recovery checks pass (7.365 seconds); strict build/63 shell hashes pass. Desktop and 320px mobile screenshots inspected, no text-section horizontal overflow; original eight SQLite hashes unchanged/integrity OK/FKs zero. Disposable owner signed out/tab closed; fixture final counts pending its graceful timeout, not yet claimed duplicate-write proof. No Reticle/live/provider/cloud/real-data verdict. See docs/TEXT_RETENTION.md.
- Approximately 70% remains an unaudited historical estimate. Next major task: separate confirmed resolved-clarification content retention, preserving open cases and outcomes and fencing expired follow-up processing/playback. Broader activity/briefing/generated audio/restore/full release gates remain. Goal active, previous implementation work is progress; no repeated Resume is needed.

- Updated (UTC): 2026-10-11 05:09, S36/A16 response-text retention foundation. Migration 070 adds a separate default-disabled site policy, exact confirmed owner/admin requests and immutable receipts. Scheduled transactional redaction clears expired worker answers/assessment quotes and recording transcripts, fences pending claims, prevents restoration, expires related stored exports and audits completion without changing historical outcomes or identities. Publication-scoped locking serializes new export snapshots with redaction. Backend API is wired; settings UI/recovery and broader activity/clarification/briefing retention are unfinished. See `docs/TEXT_RETENTION.md`.
- Final focused session 67096: 42 passed, zero failed/skipped, 10.741 seconds, disposable PGlite/SQLite fixtures and loopback HTTP only. Includes authenticated text-policy routes, worker denial, exact replay, preservation, linked transcript hashes, late result/requeue denial and audit rollback. Earlier fixture errors were corrected; one sandbox loopback EACCES run was not counted as passing. Strict build passes with existing warnings; 62 shell hashes match, original eight SQLite business hashes unchanged, integrity OK/FK violations zero. No existing database migration/policy, worker loop, real data, provider/cloud/mail call or UI/browser proof.
- Approximately 70% remains the historical unaudited estimate, not a verified measurement or readiness promotion. ONE next concrete task: add the confirmed response-text retention settings and scoped lost-acknowledgement recovery to the PostgreSQL customer privacy screen, using a disposable credential-authenticated fixture for browser verification. Then continue broader S36/A16 retention and remaining full-spec gates. Goal active; current preparation/retention work is progress. Session 67096 is terminal; no required test/build is pending. Actual checkpoint pause then continuation.

- Updated (UTC): 2026-10-11 05:00, preparation provenance checkpoint. Migration 069 records exact bounded per-stage argument/root/provider hashes and model/prompt/schema, rechecks current authority/dependencies before every request, and atomically links attached bundles to accepted request journals. Failed claims retain actual evidence; retries and Arabic-only regeneration link only their own new operations. Legacy rows remain honestly unknown. See `docs/PREPARATION_PROVENANCE.md`.
- Focused session 26622: 53 passed, zero failed/skipped, 52.704 seconds; updated report regression: four passed, zero failed/skipped, 3.609 seconds. Earlier sandbox run had three loopback EACCES failures, not counted as passes. Strict build passes, 62 shell hashes match, eight original SQLite business fingerprints unchanged, integrity OK/FK violations zero. `artifacts/pipeline-preparation-provenance-2026-10-11.json` SHA-256 `c0f5dbc005e7924e760a7af6c75e358992ad06570d516e8656898a1238f3bf58`: nine checks, 24 scripted/zero external requests, 16 operations, eight bounded preparation stage records. Earlier reports preserved; existing bundle-size/offline-import warnings remain.
- Approximately 70% remains a historical unaudited estimate, not a readiness claim. No live/provider/cloud/mail/real-data operation, existing database migration, UI/browser/hardware verification or release promotion. ONE next major task: inspect S36/A16 retention against current PostgreSQL code, especially stored text and activity versus audio-only cleanup, and implement any confirmed missing scheduled purge. Goal active; actual checkpoint pause then continuation. Earlier next-task entries below are historical.

- Updated (UTC): 2026-10-11 04:45, follow-up provenance checkpoint. Migration 068 binds future metered follow-ups to exact source/scope/actor/glossary/provider fingerprints and immutable operation links. Each dispatch rechecks authority/input; final atomic delivery requires the exact accepted one-request English speech or three-request Arabic translation/check/speech journal and matching manifest provenance. Both models/voice/prompt/schema remain explicit. Scoped deletion preserves minimal links/hashes while redacting content; unknown historical rows stay unknown. See `docs/FOLLOWUP_PROVENANCE.md`.
- Final focused session 83679: 54 passed, zero failed/skipped, 19.270 seconds. An earlier nonexistent-row denial fixture was corrected, not counted as a pass. Strict build passes, 62 shell hashes match; existing warnings remain. `artifacts/pipeline-followup-provenance-2026-10-11.json` SHA-256 `2860e35815eddc0f633aa29248a1b0167e8e12e2a6faea4feaf232d286bd7f5a`: nine checks, 24 scripted/zero external requests, 16 operations, actual bounded follow-up evidence. Earlier reports preserved. No UI/browser/live database/cloud/mail/real-data operation or readiness promotion.
- Approximately 70% remains a historical unaudited estimate. ONE next major task: exact per-stage preparation/translation/speech input/model/prompt/schema provenance and accepted completion linkage; current bundles retain dependencies but preparation request rows still lack that exact linkage. Saved draft target editing already exists in the current code; older screen-table claims are not sufficient evidence of a missing implementation. Goal remains active; actual checkpoint pause then continuation. Full specification and release gates remain intact.

- Updated (UTC): 2026-10-11 04:39, audio provenance checkpoint. Migration 067 binds future source/recorded transcription and recorded assessment to exact immutable input/model/prompt/schema operations and accepted request journals. Original transcription links survive assessment retry; accepted metadata/transcripts cannot be revised, while scoped deletion clears content and preserves minimal operation evidence. Unknown historical rows remain unknown, with no fabricated backfill. Read-only recorded evaluation verifies the exact frozen publication/question/rubric and transcription evidence. See `docs/AUDIO_PROVENANCE.md`.
- Focused session 41450: 41 passed, zero failed/skipped, 11.550 seconds. Strict build passes; 62 shell hashes match, existing warnings remain. Report `artifacts/pipeline-audio-provenance-2026-10-11.json`, SHA-256 `613c8aaa8cfaf91cb0fc7f79578956b5bb5ec7e421d800825a111333a0591931`: nine checks, 24 scripted/zero external requests, 16 operations. Four typed cases plus a separate one-completed/three-not-run recorded report; no inference-accuracy claim. Eight original SQLite business fingerprints match, integrity OK/FK violations zero. Previous incomplete-provenance report preserved.
- A03/M5 remains partial. No live provider/cloud/mail/real-data operation, existing database migration, browser/hardware/native QA or release promotion. Approximately 70% remains a historical unaudited estimate. Next major work: exact translated follow-up input/model/prompt/schema provenance and completion linkage, preserving old history. Goal active; checkpoint pause then automatic continuation. Earlier status entries below are historical.

- Updated (UTC): 2026-10-11 04:25, isolated backend pipeline checkpoint. A03/M5 remains partial. `npm run evaluate:rehearsal` creates and closes a fresh in-memory PGlite schema. It accepts no existing database, provider credential or live transport. Normal credential bootstrap, sessions and worker grants lead through private source audio, transcription/draft, automatic EN/AR preparation and speech, ordinary publication, typed/recorded answers, help, private follow-up and reports. No completed business results are manually inserted.
- Nine workflow checks pass: 24 scripted requests, zero external requests, 16 real metered operations and 24 reserved/accepted slots. Exhausted budgets deny later draft generation; revoked credentials deny private audio. Publication/replay evidence remains intact and independent help does not alter response metrics. Four typed outcomes have exact runtime input/model/prompt/schema evidence. A separately pinned schema-v2 dataset freezes localized questions without changing the original 43-case dataset or 19-case local regression.
- Final focused session 84908: 34 passed, zero failed/skipped, 13.765 seconds. Strict build passes (`index-5bxoc4S2.js`, 558.51 kB / 150.29 gzip), all 62 shell hashes match; existing warnings remain. Initial fixture errors and the shell-verifier object-shape error were corrected, not counted as passes. Final report: `artifacts/pipeline-rehearsal-2026-10-11-final.json`, SHA-256 `27761e16e15eeffbec6d0ffa95625a1eb6710d5c2937c5ffee2a710a97a04a9c`, CLI exit 0. Eight existing SQLite business hashes match the 04:07 baseline, integrity OK, foreign-key violations zero; no claim about all tables. CI command configured, not freshly run on hosted CI.
- Scripted outcomes and tone audio do not prove AI accuracy or spoken-audio quality. Source and recorded exact input/prompt/schema linkage is explicitly incomplete. No live provider, mail, cloud, deployment or real-data operation; no browser/hardware/native-QA/pilot/release promotion. Approximately 70% remains historical and unaudited. ONE next major task: persist and fence complete source/recorded input/model/prompt/schema provenance and link actual operations to completion, without invented legacy backfill. See `docs/PIPELINE_REHEARSAL.md`. Goal remains active; actual 30-second checkpoint pause, then resume.

- Updated (UTC): 2026-10-11 04:07, versioned assessment evaluation checkpoint. A03/M5 partial: 43 catalog-pinned synthetic samples (34 semantic/nine protocol faults), four frozen shelf/carton question/rubric versions, EN/AR/UR plus unsupported-language probe; labels engineering-authored, not native QA. Runner records actual publication/version, source/question/rubric/input/model/prompt/schema/result/evidence hashes, safe reason codes and separate false-match/false-clarification/false-unassessable/failed/not-run/confusion metrics; semantic/fault metrics split. Content changes require a new registered dataset version. Read-only repeatable-snapshot PostgreSQL maintenance observations require exact fixture content/current generated publication ID and linked immutable synthetic operation/one accepted request for provider completion. Scoped denials, wrong input/version/provenance, pending/failed/blocked preservation and unchanged fingerprints tested. No worker/provider dispatch in the reader; partial semantic coverage exits nonzero. Generated JSON uses exclusive creation, no checkpoint overwrite. 36 focused evaluation/PG/assessment-provider/Gemini/domain tests passed (23.148 sec); final request-validation guard followed, then ten final evaluation/PG checks passed (5.563 sec), no failed/skipped. Initial duplicate worker/publication fixture corrected with separate workers, constraints unchanged. Lost prior test handle explicitly missing; unseen run not counted, repeated check terminal. Final contract report 43/43 checks, 42 mocks/zero external requests; six injected execution failures stay failed, three bad-evidence results unassessable. Hand-labeled semantic mocks are tautological, not accuracy. Actual local report: 24/34 semantic samples run, ten unsupported not-run, five disagreements (three valid AR/UR paraphrases unassessable; noise/French clarification), exit1 not pass; original19 local regression retained. Final artifacts/report hashes verified; preliminary reports retained separately. Strict build passes index-5bxoc4S2.js 558.51 kB/150.29gzip; all62 shell hashes match, existing warnings remain. Backend/CLI-only, no UI/hardware/fresh hosted CI/full regression claim. Preview ports were authoritatively closed after an observation context change; restored synthetic/email-disabled API session70421/PID26340 on3021 and Vite2745/PID14904 on3020 without worker. Eight business hashes match before/after, integrity OK/FKs0 (evaluation-preview-checkpoint-2026-10-11.json). Initial restricted CIM listener read denied, approved read verified closed then restored listeners. No live/cloud/mail/deployment/real-worker operation. Tolerances awaiting agreement, independent native QA absent, provider transport/full pipeline/accuracy/audio/pilot readiness unverified. Approximately70% remains historical/unaudited; full goal active. ONE next major task: repeatable isolated end-to-end evaluation/rehearsal workflow with persisted exact input/model provenance and explicit provider-request budgets; live sends only with separate authorization. Actual Neon Free/R2/TLS/proxy/restore/concurrency/reference/device/a11y/security/performance/fresh CI/release and approved real-data/Urdu capabilities remain. See docs/VERSIONED_EVALUATION.md. Continue after actual30-second checkpoint pause.

- Updated (UTC): 2026-10-10 17:21, dedicated provider-stage test checkpoint. Migration 066 and explicit local synthetic operator commands implement AR/UR translation (two requests: generation/automated comparison) and EN/AR speech (one: fixed-text/nonempty PCM16 WAV), never client/worker content. Exact budgets/current actor/context/pause/deadline guards, immutable receipts/config-fixture matching and bounded diagnostics/evidence are enforced; Urdu speech denied before reservation. Staff reads safe results without dispatch; disabled/mismatched runtime stages and full accuracy/readiness remain unpromoted. Browser confirmations separated; selection resets consent. Final focused provider-readiness/provider-stage/provider-controls/operations/postgres-runtime/hosted-runtime/postgres/postgres-embedded command: 33 passed, zero failed/skipped, 14.157 sec with approved local socket access. Earlier malformed mock/incorrect denial assertion and four restricted HTTP EACCES errors corrected; failed runs not passes. Final strict build index-5bxoc4S2.js 558.51 kB/150.29 gzip; 62 shell hashes match, existing warnings remain. Built disposable mock-provider PGlite verifies lost acknowledgement/receipt outage/reload, repeated delivery without inference duplication, Arabic speech, staff inspection, final production-evaluation labels and desktop/320px results (body305/viewport320/no row overflow). Final counts: zero external calls, three mock requests, two operations, three accepted requests, one staff inspection, three operator POST deliveries, one lost acknowledgement/outage; trace shows two deliveries before outage, GET-only reload recovery. All fixtures stopped, temporary tabs closed/viewport reset. An earlier premature fixture used the prior build and stopped at zero test writes; final build script explicitly verified. Reticle unconnected/no verdict. Main synthetic/email-disabled API intentionally restarted to session13926/PID28240 on3021; Vite66436/PID24600 on3020 unchanged. Eight selected business hashes match before/after, integrity OK/FKs zero in artifacts/provider-stage-tests-preview-checkpoint.json; earlier checkpoint used another hash method, no cross-method equality claim. No main business/live-provider/cloud/mail/deployment/real-data operation. Full production remains incomplete; approximately70% remains historical/unaudited. ONE next major task: versioned multilingual evaluation runner/dataset with exact question/rubric/model provenance and separate false-match/false-clarification/unassessable reporting. Live/Urdu/real-data/Neon Free/R2/proxy/restore/concurrency/reference/device/a11y/security/performance/fresh CI/release gates remain. See docs/PROVIDER_STAGE_TESTS.md. Goal active; continue automatically after actual30-second checkpoint pause.

- Updated (UTC): 2026-10-10 16:54, provider-stage readiness checkpoint. S31/S39 partial: server-only immutable seven-stage projection now reaches scoped staff readiness and separate operator provider views. Actual known runtime handles distinguish configured/disabled, known models and declared EN/AR/UR text versus EN/AR speech; transcription coverage remains undeclared, Urdu speech unavailable. No secrets/input allowlists/key-derived fingerprints/functions are projected. Inspection sends no provider request, clients cannot forge stage settings; fixed-text connection success cannot promote stage verification or production readiness. Twenty-five focused provider-readiness/usage-model/provider-controls/settings/postgres-runtime/hosted-runtime tests pass, zero failures/skips (10.417 sec), approved local loopback access. Earlier restricted five socket errors, fixture UUID/operator-context errors and missing browser staff credential were corrected without loosening application auth; those failed runs are not passes. Strict optimized build passes: entry index-DKeP8fgv.js 558.50 kB/150.29 gzip; existing chunk/dynamic-import warnings remain. All 62 shell manifest path/hash entries match; initial wrong-field verifier failed before checking. Disposable built PGlite browser verifies both views at 1440/320 pixels, seven configured/not-tested stages, Urdu unavailable, one staff inspection result and 320-pixel stage-text containment. Fixture counters: zero provider calls/reservations/verifications/operator POSTs, one inspection POST; stopped, temporary tab closed and viewport reset. Screenshots artifacts/provider-readiness-desktop.jpg, provider-readiness-mobile.jpg and provider-operations-desktop.jpg. Reticle unconnected/no verdict. Existing synthetic/email-disabled API intentionally restarted to load shared server changes: session 25838/PID26872, Vite session66436/PID24600; listeners 3021/3020 and API health verified. Post-restart eight selected business fingerprints, integrity ok/FKs zero recorded in artifacts/provider-readiness-preview-checkpoint.json; pre-restart inspector quoting failed, so no verified before/after equality claim. No intentional main business/provider/cloud/mail/deployment/real-worker operations. Dedicated budgeted translation/speech tests, live/accuracy/Urdu speech, approved real-data provider, Neon Free/R2/proxy/restore/concurrency and all-reference/device/accessibility/security/performance/fresh release gates remain open. Approximately 70% remains historical/unaudited, not readiness. Goal active. ONE next major task: implement explicit budgeted synthetic translation/speech verification with durable exact receipts/results and configuration matching, distinct from full-pipeline readiness and language accuracy. See docs/PROVIDER_READINESS.md. Continue automatically after actual 30-second checkpoint pause.

- Updated (UTC): 2026-10-10 16:35, preparation/typed-assessment runtime checkpoint. Owner root, D:/understod (no Git), spec 2026-10-02, M2/M5 and S09-S24/S31/S38-S39/A01-A04/A06/A08/A13 partial. Migrations 064/065 and default-off LOCAL synthetic credential Gemini handles connect preparation/translation/private speech and arbitrary frozen-rubric typed assessment to the awaited PostgreSQL worker. Exact complete-input allowlists, immutable requester authority, model/prompt/schema/hash provenance, per-request quotas and actor/worker/tenant/pause/lease fences protect dispatch and late results. Read-only scoped maintenance fingerprints print no private text. Separate operator can explicitly requeue a blocked assessment without changing its receipt/allowlist; failed/blocked retry heading reflects actual state. A noncanonical cartons/bay English/Arabic preparation -> private speech -> publication -> Arabic typed assessment passes after later draft edits. Evidence: `node --test tests/assessment-provider.test.mjs tests/preparation-provider.test.mjs tests/recording-config.test.mjs tests/postgres.test.mjs`: 21 passed, zero failed/skipped (19.668 sec). Focused embedded DB/local HTTP regression of postgres-domain/provider-controls/postgres-runtime/hosted-runtime/postgres-embedded/postgres-import/case-repeats/case-reviews/deletions: 83 passed, zero failed/skipped (63.130 sec), local socket access. Final `node --test tests/assessment-provider.test.mjs tests/operations.test.mjs`: 12 passed, zero failed/skipped (20.231 sec), local socket access. Earlier fixture state/missing-or-invalid tenant reason errors were corrected without changing database constraints; failed runs not counted as passes. Final `npm run build` passes after retry-heading copy; index-B-jFYxh1.js 558.42 kB / 150.25 kB gzip, existing chunk/dynamic-import warnings remain. Reticle unconnected/no verdict; no native/UI/hardware proof this checkpoint. All required test/build sessions terminal; existing preview listeners verified 3021/PID15600 and 3020/PID24600 at 16:32 UTC, no restart. No saved main business/provider/mail/cloud/deployment/real-worker operations. Urdu speech, approved real-data provider, Neon/R2/proxy/restore/multi-process concurrency, all-reference/a11y/device/security/performance/fresh release gates remain open. Approximately 70% is historical/unaudited; goal active. Details: docs/PREPARATION_PIPELINE.md and docs/ASSESSMENT_PIPELINE.md. ONE next major task: wire actual configured provider-stage/capability metadata into language-readiness and operations views, keeping fixed-text connection tests distinct from full-pipeline readiness. Continue automatically after actual 30-second checkpoint pause.

- Final build integrity supplement (16:35 UTC): read-only Node `readFile`/`JSON.parse`/SHA-256 verification of every `const files` entry in dist/sw.js reports 60 matching built shell hashes. Initial verifier used the wrong constant name and stopped without checking; corrected verifier passes. This is build integrity evidence, not browser/offline behavior.

- Updated (UTC): 2026-10-10 16:05, recorded-answer runtime checkpoint. PostgreSQL migration 063 and optional default-off recording stage connect accepted private answer WAVs to transcription and frozen-rubric assessment. Explicit LOCAL synthetic credential Gemini handle requires known synthetic WAV hashes and persisted global/tenant quotas; hosted enablement rejected. Transcription/assessment reserve four/one requests separately, saved transcript survives assessment retry, cleanup remains bounded after pause. Worker/global/provider/tenant/lease/purge checks fence dispatch and late results; repeated voice attempt does not duplicate or resolve original case. Focused regression: 31 passed (10.125 sec), four recording-domain checks passed (5.467 sec), seven isolated runtime/hosted HTTP checks passed with local socket access (2.724 sec), all zero failed/skipped. Earlier restricted HTTP run had two loopback EACCES failures, not application failures; terminal rerun passes. Strict optimized build passes, unchanged entry 558.42 kB / 150.26 kB gzip with existing warnings. HTTP fixture proves default pending, worker-cycle completion, exact upload replay and one recording/receipt, preserved assignment-based metrics; providers mocked, no live call. Reticle unconnected/no verdict. Preview listeners remain 3021/PID15600 and 3020/PID24600; no saved main business/cloud/provider/mail/deployment/real-worker mutation. Native microphone/phone, real PostgreSQL concurrency, live privacy-approved pipeline and full release gates remain. Historical approximately 70% estimate is unaudited; goal active. See docs/RECORDING_PIPELINE.md. Next major work: environment-enabled preparation/multilingual generation through the authoritative runtime, with provider/privacy/quota gates. Continue after actual 30-second checkpoint pause.

- Updated (UTC): 2026-10-10 15:52, shared-device checkpoint. Tabs default to shared mode; explicit private choice is exact-session/expiry-bound. Switching to shared warns before saved unsent loss, invalidates older tab choices before verified independent cleanup, and guards actual browser text/audio/cache writes. Local-only entry locks on policy change. EN/AR/UR in-app confirmation dialog replaces a stalled native confirm. Final focused regression 51 passed, zero failed/skipped (2.952 sec), strict build passes (558.42 kB / 150.26 kB gzip; existing warnings remain). Native disposable built Urdu verifies cancel, private reload persistence, confirmed zero-briefing/no-recording reset, three disabled private-save controls and sign-out. Screenshot artifacts/worker-shared-device-reset.jpg. Fixture 70424 stopped cleanly: 30 API reads, zero worker POSTs/recordings/answer receipts; successful QA tab closed. Earlier restricted 84923 stopped at zero reads/writes. Reticle unconnected/no verdict. Earlier error tabs/unverified offline-clear are not retroactively claimed cleaned. Main 3020/3021 listeners remain present; no saved main business/provider/cloud/mail/deployment/real-data writes. Hardware/phone/cross-tab failure journeys, runtime parity and full production/release gates remain. Historical about 70% estimate remains unaudited; goal active. Next major work: authoritative runtime/repository feature parity, with cloud/live gates separately blocked until provisioned/approved. See docs/WORKER_SHARED_DEVICE.md. Continue automatically after actual 30-second checkpoint pause.

- Updated (UTC): 2026-10-10 15:41, public-shell repair follow-up. Readiness now requires bounded exact worker acknowledgement after SHA-256 verification of every cached manifest entry; explicit Retry repairs missing cache without skipWaiting or forced navigation. Waiting updates have localized save-before-reload instructions. 19 focused shell/state/offline/cleanup tests pass, zero failed/skipped (2.938 sec), strict build passes (557.91 kB / 150.08 kB gzip entry; existing warnings remain). Native disposable 3195 proves cache removal/reload reports Unavailable, explicit repair with older tab open reports Available, then origin-wide 503 opens exact Urdu text/question/local audio and retains the separate answer. Fresh unbound tab is locked with no identity/text/audio. Screenshot artifacts/worker-offline-repaired-shell.jpg. Fixture 26104 stopped cleanly: zero worker POSTs/recordings/answer receipts, 19 API reads. Browser subsequently disconnected; last offline-clear action and browser cleanup unverified, not a pass. Reticle unconnected/no verdict. Different-build waiting upgrade, physical/hardware/phone/reconnect/shared-device and production/release gates remain. No external provider/mail/cloud/deployment or main-business writes. Historical estimate about 70% remains unaudited; goal active.

- Updated (UTC): 2026-10-10 15:21, private offline-briefing checkpoint. Explicit consent now saves a bounded encrypted exact-version text/question/audio/notice snapshot separately from the answer outbox. Transport/5xx bootstrap offers a same-tab local-only reader, never online authentication; local recorder has no upload action and reconnect remains explicit. 37 focused tests pass, zero failures/skips (2.894 sec), strict build passes (557.29 kB entry warning remains). Native disposable Urdu reader/playback and same-tab reload pass under origin-wide 503; final save confirmation and independent cache/answer removal pass. Fixture stopped cleanly at zero worker POSTs/recordings/assignment answer receipts, 62 GETs. Public-shell removal/update with an older tab still open exposes a readiness/outage bug; final updated-shell outage and native new-tab/clear/reconnect proof remain unfinished. Reticle unconnected/no verdict. Screenshot artifacts/worker-offline-cleanup.jpg. Main synthetic/email-disabled API 59159 and Vite 66436 restored on 3021/3020; seven selected business/settings hashes unchanged, integrity ok/FKs zero. No provider/cloud/mail/deployment/real data operation. Shared-device/phone/hardware, repository/runtime, live privacy-approved AI and full release gates remain; percentage unaudited, historical estimate about 70%, goal active. See docs/WORKER_OFFLINE.md. Continue automatically after actual 30-second checkpoint pause.

- Updated (UTC): 2026-10-10 11:04, bounded private audio-outbox checkpoint. Opt-in encrypted storage now retains separate exact-assignment recordings with atomic 10-recording/25-MiB caps, hashed slot keys, legacy recovery and queue-wide verified session purge. Device controls provide private preview, explicit receipt-aware send/check and individual/all removal; no automatic upload. 20 focused tests pass, zero failed/skipped (0.168 sec), and strict optimized build passes (545.19 kB entry warning remains). Native synthetic harness proves count/byte caps, independent removal and lost-ack/withdrawal recovery at one POST/recording/receipt. Dev worker device UI restores two entries after reload, verifies historical receipt and retains unavailable-assignment conflict; Urdu assignment scope survives English UI preference. Desktop screenshot inline only; no saved artifact, phone, real mic or full outage proof. Reticle unconnected/no verdict. Disposable worker signed out, successful QA tab closed, fixture stopped; no main business data, provider/cloud/mail/deployment/real worker operation. Private briefing offline reopening/cache/bootstrap, shared-device/full disconnect journeys, SQLite feature parity and production/release gates remain. Percentage unaudited; goal stays active and continues automatically after actual 30-second checkpoint pause. See docs/WORKER_AUDIO_OUTBOX.md.

- Updated (UTC): 2026-10-10 10:45, private voice-conversation checkpoint. Migration 062 adds worker help/reply WAV staging, exact readback/receipt recovery, separate conversation messages and private playback. No answer receipt, assessment or fabricated transcript is created. Acceptance rechecks authority/publication/case; retention/deletion verifies object absence and rechecks late writes. UI reuses notice-gated recorder with preview, exact retry and metadata-only recovery; uncertain previews cannot be replaced. Fixed shared worker UI so answer expiry does not hide independent help. Focused voice/recovery/session/notice run: 11 passed (13.837 sec); earlier overlapping backend/migration/follow-up/review run: 25 passed (13.560 sec). Runtime/state rerun: eight passed (2.328 sec); initial loopback EACCES failures were permission limitations, reruns pass. Embedded/redaction checks also pass. Strict build passes, entry 544.80 kB warning open. Built disposable browser verifies post-deadline help controls, private two-second synthetic voice playback and reply control; no microphone capture/upload/reload/mobile proof. Fixture stopped and QA tab closed; original evidence hash unchanged, one assignment/case/answer receipt, one separate voice reply. Reticle remains unknown/unconnected. Main synthetic preview stays available; no saved business, cloud, provider, deployment, mail or real worker data changed. SQLite parity, full offline outbox, lost-preview cancellation, real microphone/phone, privacy-approved live pipeline, cloud and final release/reference gates remain. Percentage unaudited; goal active. Continue automatically after actual 30-second pause. See docs/CASE_VOICE.md.

- Updated (UTC): 2026-10-10 10:24, case-review checkpoint. PostgreSQL migration 061 adds append-only private disagreement and independent compare-and-set case deadlines. Original assessment/answer/routing/assignment evidence is unchanged; overdue filtering and escalation use the effective deadline. Scoped role/actor/replay/audit/deletion guards and metadata-only client recovery are implemented. Focused review/recovery/routing/privacy/migration/import regression: 25 passed, zero failed/skipped (18.803 sec). Strict build passes; entry 538.19 kB warning remains. Built disposable browser verifies lost acknowledgement/read failure/exact recovery, private disagreement and durable history after reload. Graceful counters: two POSTs/two receipt reads/two reviews, one assignment/case/answer receipt, original hash unchanged. Pending-draft reload not browser-proven; screenshot inline only. QA tab closed/fixture stopped. Reticle unknown/unconnected; automatic dev wiring removed. Main preview unchanged. No external provider/cloud/mail/deployment/real data. Voice help/replies, SQLite parity and production gates remain. Percentage unaudited; goal active. Automatic continuation after actual 30-second pause, no Resume click needed. See docs/CASE_REVIEWS.md.

- Updated (UTC): 2026-10-10 10:07, repeat-answer checkpoint. Migration 060 adds PostgreSQL scoped supervisor repeat requests with explicit independent answer deadlines, immutable identity/deadline/receipt links, exact recovery and one pending request per assignment. Typed/private recorded acceptance rechecks authority/publication/case/deadline and consumes the request atomically. New assessed attempts retain original evidence/case and assignment-based metrics; no duplicate case or automatic resolution. Staff recovery and worker To do/Follow-up controls are built. Relevant regression: 75 passed (52.254 sec); overlapping conversation/privacy/import compatibility: 27 passed (14.012 sec), zero failures/skips. Strict optimized build passes; 531.82 kB entry warning remains. Built disposable credential browser verifies lost acknowledgement/read failure/reload recovery, inbox after original expiry, new typed receipt, two preserved attempts and submitted repeat in original case. Fixture tab closed/process 59695 terminated; no shutdown counters, wire-count/mobile/cloud/live-AI proof claimed. Reticle unavailable. Main synthetic/email-disabled preview 39521 remains on 3020/3021; saved evidence not edited. No deployment/provider/mail/real data. Disagreement/editable case deadlines, voice replies, SQLite repeat parity and full production gates remain. Percentage unaudited; goal active, automatic continuation after actual 30-second checkpoint pause. See docs/CASE_REPEATS.md.

- Updated (UTC): 2026-10-10 06:14, generated follow-up checkpoint. Migration 059 connects PostgreSQL scoped durable translation/check/exact-text speech, private staging/readback/atomic message delivery, GET-only receipt recovery, per-operation provider quotas, scoped playback and retention/deletion cleanup. Worker Follow-up inbox is independent of original-answer status; metadata-only staff message notifications are added. Gemini remains disabled by default, synthetic local credential rehearsal only, EN/AR speech; hosted/real-data/Urdu speech dispatch remains closed. Focused checks: 30 passed (11.419 sec), then overlapping queue/quota/privacy/migration/import/runtime 37 passed (15.597 sec), zero failures/skips. Strict build passes; entry 525.60 kB warning remains for final performance pass. Built Arabic UI verifies unknown acknowledgement/failed receipt/reload recovery and private tone playback (2 sec, readyState 4, no error, advancing time), plus Follow-up (1) selection. Not live speech, language QA, mobile or wire/cloud evidence. Disposable worker signed out, tab closed, fixture 5744 stopped. Reticle unconnected, no verdict; optional external feedback rejected by auto-review, not bypassed. Main synthetic/email-disabled preview 39521 now serves current SQLite inbox backend on 3020/3021; seven selected business/settings hashes unchanged, messages zero, integrity ok/FK errors zero. No live provider/cloud/mail/real-data call. Assessed repeats/rebrief, voice replies, disagreement/editable deadlines, generated SQLite parity and full production/release gates remain. Percentage unaudited; goal active, automatic continuation after actual 30-second checkpoint pause. See docs/CASE_FOLLOWUPS.md.

- Final conversation preview refresh: synthetic/email-disabled 11528 now serves 3020/3021 with migration-058-equivalent SQLite setup. Seven selected business/settings hashes remain unchanged, message ledger is empty, integrity ok/FK errors zero, native original overview remains 30/25/22/3/5. Final built native guard prevents leaving with unsent text and preserves it; original response/facts precede conversation. Disposable identities signed out, tabs closed, fixtures 15254/69278 stopped. Final strict build passes (entry 522.95 kB warning open). No real-data/provider/cloud/mail calls. Continue automatically to remaining major requirements after an actual 30-second checkpoint pause.

- Conversation text checkpoint (2026-10-10): migration 058 and paired SQLite/PostgreSQL repositories add scoped two-way append-only messages, exact replay/receipt recovery, private-note separation and deletion redaction/cutover preservation. English staff delivery only; untranslated AR/UR delivery explicitly blocked. Seven focused conversation/recovery/HTTP checks pass (2.948 sec); earlier 14-test populated import/repository run passes (10.614 sec). Built memory-only credential UI verifies lost acknowledgement, failed receipt read, reload reconciliation without resending and worker reply; counters two POSTs/messages/audits. Strict build passes, entry 522.59 kB warning remains. Final navigation/layout changes await rebuild/native confirmation. Reticle unconnected; no pass/mobile/live/cloud proof. Disposable fixture 15254 still running, main 71133 backend still predates 058. Translated private voice delivery, notifications, repeated assessed follow-up/disagreement/editable deadlines and release/cloud gates remain. Percentage unaudited; goal active and continuation automatic, no Resume button needed. See docs/CASE_CONVERSATIONS.md.

- Routing checkpoint preview refresh (2026-10-10): earlier 89533 stopped intentionally; synthetic/email-disabled 71133 now serves the latest backend on 3020/3021. Seven selected business/settings table hashes are unchanged; routing/lifecycle/request ledgers remain empty, integrity is ok and foreign-key errors are zero. Native demo overview retains original 30 assigned / 25 responses / 22 matches / 3 clarification outcomes / 5 pending. The refreshed preview is left available; no existing business evidence was changed.

- Updated (UTC): 2026-10-10 05:24, case-routing checkpoint. Migration 057 adds transactional eligible primary/deputy routing for new help/assessment cases, independent 24-hour deadlines and one-time overdue escalation. Manual ownership, resolved cases, unavailable workers/contacts and archived sites suppress automatic escalation; PostgreSQL honors operator dispatch controls. Original evidence and legacy cases are not rewritten. Final focused regression: 90 passed, zero failed/skipped (56.677 seconds), including populated cutover deadlines. Strict optimized build passes; entry 513.42 kB size warning remains. Built memory-only credential UI verifies primary assignment, next-day deadline, overdue filtering, deputy/escalation time and reload persistence. Desktop screenshot inspected, no saved artifact/mobile or Reticle verdict. Disposable session signed out, tab closed, fixture 69695 stopped. Main preview refresh is pending below. No provider/cloud/mail/real-data operation. Full translated conversation, disagreement, editable deadlines and release/live/cloud gates remain. Percentage unaudited; active goal continues automatically without repeated Resume clicks. See docs/CASE_ROUTING.md.

- Updated (UTC): 2026-10-10 05:10, site lifecycle checkpoint. Migration 056 adds credential-owner dependency-checked archive/restore, immutable receipt/audit, worker-session/link revocation and operational admission guards. Staff retain history and privacy controls; restore leaves worker access paused. Site/import/migration: 27 passed, zero failed/skipped (11.106 seconds). Related auth/domain/settings/templates/glossary/privacy/schedule/reminder regression: 100 passed, zero failed/skipped (59.538 seconds); initial 29 loopback EACCES failures resolved by rerunning with local socket permission. Strict build passes; 513.04 kB entry warning remains. Built memory-only native UI proves published/case dependency barrier, cancel, lost-ack/receipt-read failure, reload recovery at one command/receipt, archived staff read-only view and current-site restore at two commands/receipts, worker access still paused. Screenshot inspected, no saved artifact/mobile or Reticle verdict. Disposable identity signed out, tab closed, fixture 36862 stopped. Main preview 89533 still uses earlier backend until explicitly refreshed; do not treat its new lifecycle API as loaded yet. No provider/cloud/mail/real-data call. Full worker follow-up conversation, actual wire/cloud/live/privacy-approved processing and final release/reference gates remain. Percentage unaudited; active goal continues automatically, no Resume clicks needed. See docs/SITE_LIFECYCLE.md.

- Updated (UTC): 2026-10-09 21:21, worker site-access checkpoint. Migration 055 adds owner/account-scoped revisioned pause/resume, immutable receipt and audit, atomic worker-session/grant revocation and worker-admission fences in SQLite/PostgreSQL. Resume never restores old access. Settings confirms impact and recovers unknown outcomes by GET-only receipt without automatic repeats. Site/import/migration: 22 passed. Broader authorization/recording/domain: 63 passed, four missing-site error-contract failures; shared guards corrected, all 15 affected site/notice/response checks then pass. Strict optimized build passes; 509.43 kB entry warning remains for performance pass. Built memory-only browser verifies cancel, lost pause acknowledgement/receipt read, reload recovery at one command/receipt/revision, resume at two and unchanged owner/current site. Screenshot inspected, no saved artifact/mobile proof. Fixture stopped, disposable identity signed out and tab closed. Reticle unconnected; no pass claimed. Site archive/restore and live/cloud/full release gates remain. Percentage unaudited; goal active, automatic continuation, no Resume clicks needed. See docs/SITE_WORKER_ACCESS.md.

- Updated (UTC): 2026-10-09 21:05, additional-site checkpoint. Migration 054 adds immutable scoped creation receipts; credential owners atomically create site/defaults/linked owner/primary contact/audit without copying credentials or switching session. Settings has a paginated catalog, confirmed form and tab-durable GET-only recovery; both HTTP backends require exact client context. Populated backup/import preserves evidence. Final focused site/import/embedded run: 14 passed, zero failed/skipped (10.261 seconds); strict optimized build passes, with the existing entry bundle now 501.87 kB and a size warning to address in the final performance pass. Built native memory fixture proves one lost-acknowledgement POST/receipt/audit and reload recovery, new picker membership and unchanged current site. Desktop screenshot inspected, no saved artifact/mobile check claimed. Reticle unconnected, feedback filed. Fixture stopped; initial failed-navigation tab closure and fixture-only cleanup navigation were blocked by browser policy, successful QA tab closed. No cloud/provider/mail/real-data operation. Site archive/access lifecycle and full production/live/deployment/release gates remain. Percentage unaudited; goal active, continue automatically.

- Updated (UTC): 2026-10-09 20:49, fresh-workspace continuation after an actual 30-second checkpoint pause. Migration 053 adds immutable bootstrap receipts; explicit synthetic maintenance atomically creates organization/site/settings/first owner/credential/account link/primary contact/audit. No default credentials or public signup endpoint. Exact retry preserves identity and performs no writes; changed payload/password, existing email takeover and old-password restoration after rotation are denied. Audit failure fully rolls back and can recover. Importer protects nonempty bootstrap targets. Final focused run: 34 passed, zero failed/skipped (9.550 seconds); earlier embedded migration/import compatibility run: 14 passed (10.434 seconds). Strict build passed earlier in this checkpoint; later edits are backend/tests/docs only. Reticle still has no connected browser, recorded as unproved and feedback filed/yielded. Preview session 89533 remains live on 3020/3021. No external cloud/provider/deployment/purchase or real worker data. Site lifecycle, full live/privacy pipeline, actual TLS/Neon/R2/proxy and final release/UI/reference/device verification remain. Overall percentage remains unaudited, not production-ready. Goal active; continue automatically, no repeated Resume clicks needed.

- Updated (UTC): 2026-10-09 20:41, hosted-runtime foundation checkpoint. PostgreSQL customer/operator routes now share an explicit synthetic-only hosted staging launcher with trusted HTTPS-proxy validation, verified client-IP auth budgets, Secure host-only customer cookies, bounded optimized static delivery and a separate R2-backed worker. Startup checks migrations read-only; no automatic DDL/seed. Production/real-data/demo/free-provider modes remain rejected. Fixed shared disabled pilot-email null revalidation. Strict build passes; 26 focused local synthetic hosted/auth/operator/runtime/pilot checks pass, zero failed/skipped (9.083 seconds). Actual TLS/Render proxy contract, Neon/R2/cloud behavior, browser CSP/PWA, full live/privacy and broad final release/reference gates remain unverified. No deployment, purchase, provider/cloud request or real worker data used. Overall percentage remains unaudited; goal active, no Resume action required.

- Final combined checkpoint check: 36 focused tests passed, zero failed or skipped (8.869 seconds), covering provider quotas/configuration/contracts, migration ledger, operator HTTP/runtime and storage probes through migration 052. TypeScript also passes. Broad regression/build/browser/reference and deployed-service checks remain unrun for this checkpoint.

- Updated (UTC): 2026-10-09 20:28, storage-readiness continuation after the requested 30-second pause. Migration 052 journals opt-in synthetic storage probes before I/O, verifies canonical/original write and exact readback, deletes only its own random references and verifies absence. Expired leases recover cleanup without repeating writes; failed absence checks back off five minutes, and pending cleanup remains active when new probes are disabled. Completed evidence is immutable; operator UI separates adapter response/stale/failure/cleanup status from unverified cloud privacy. Three focused storage checks and nine operator/runtime checks pass, plus TypeScript. Actual file operations used only an isolated disposable local temp directory; no cloud/provider/hardware operation. Production runtime, full live pipeline and final broad release/UI/reference/parallel reliability verification remain. Overall completion percentage remains unaudited. Goal active; no Resume action required.

- Updated (UTC): 2026-10-09 20:20, major provider-operations checkpoint. Migration 051 adds default-closed global/per-tenant UTC request-slot policies, atomic reservation accounting and immutable request/verification evidence. Allowlisted PostgreSQL synthetic source attempts reserve four slots and recheck authority/pause per request; already-reserved deletion can finish after pause. Fixed synthetic text connection tests reserve one slot, validate output, bind current operator session and recover exact receipts without automatic redispatch. Operators now have quota/configuration/connection/unknown-cost controls. Normal Gemini network calls require a request journal, so standalone SQLite cannot dispatch unmetered source calls. Focused checks: 24 provider/config/adapter/migration passes plus nine operator/runtime passes; TypeScript passes. All provider responses mocked, no live service/real audio used. Reticle had no connected session; browser/reference/full regression remain deferred. Completion percentage remains unaudited; production readiness not achieved. Goal remains active, no repeated Resume clicks needed.

- Updated (UTC): 2026-10-09 20:00, operator worker-health continuation. Migration 050 records throttled process/stage observations, redacted failure-stage names and graceful shutdown; the operator screen now distinguishes current/degraded/stale/stopped/unknown workers. Nine focused operator/runtime checks and TypeScript pass. Pilot-mail dispatch also honors global operational pause while expiry and already-sent acknowledgement journaling continue. Main preview restored outside the network-restricted sandbox as synthetic/email-disabled session 89533 on 3020/3021; bounded loopback check confirms demo operator availability is false. Initial sandboxed preview was explicitly stopped, not left running. Provider quotas/verification, storage readiness, production runtime and final comprehensive release review remain. No external service or real worker data used.

- Updated (UTC): 2026-10-09 19:52, major operator requirements checkpoint. Migration 049 adds separate PostgreSQL platform identities/sessions, audited exact-actor controls and tenant suspension. The new `#operations` console supports metadata-only jobs/tenants/audit, dispatch pauses and confirmed same-job preparation/assessment/export retries, with metadata-first receipt recovery. Customer owners/demo users cannot enter; SQLite explicitly reports unavailable. Suspension revokes customer sessions and fences new access and operational dispatch/completion; privacy cleanup continues. Four focused synthetic PGlite/local-HTTP tests and TypeScript pass. Worker/storage/provider readiness is still unverified, not inferred; provider budgets, full production runtime and comprehensive release verification remain. No live services or real worker data used. Full-build completion percentage remains unaudited; earlier percentages are historical. Continuing major requirements without requiring repeated Resume clicks.

- Updated (UTC): 2026-10-09 15:56, large-workflow implementation batch. Saved draft language changes now queue fresh preparation with actor-bound recovery receipts while preserving published history. Public product/walkthrough/pilot pages and private inquiry persistence exist on SQLite/PostgreSQL (migration 047), with exact retries, secret receipt lookup, throttling, bounded mocked-mail delivery, expiry and no AI contact-data processing. Persisted site onboarding (migration 048) connects existing organization/site/support/contact/language/access/briefing workflows; progress does not establish production/provider readiness. Six focused tests pass, including both database backends, plus TypeScript. Broad regression, built-browser/reference/accessibility and live/cloud verification are deliberately deferred until the major requirements are implemented, per user direction. S02/S03/S07 remain partial; public speech is device-example playback, not live AI. Operator/provider and production-runtime work remains. Older percentages are historical estimates, not a current audited readiness measure.

- Updated (UTC): 2026-10-09 15:20, source provider privacy checkpoint
- Source transcription now defaults to disabled. Explicit Gemini Free opt-in requires an isolated local synthetic credential runtime and a bounded operator-controlled allowlist of known synthetic canonical WAV hashes. Unknown sources are blocked before private storage reads or provider calls; the adapter independently verifies and snapshots permitted bytes. The exposed handle cannot prepare/assess arbitrary text. Full suite: 539 tests, 536 passed, zero failed, three external PostgreSQL skips (96.584 sec). Focused privacy/configuration/SQLite/PostgreSQL tests: 53 passed. Strict build and all 48 public-shell hashes pass. Main 50452 was replaced by synthetic/email-disabled 72990 on 3020/3021; native original overview, selected business hashes, empty source/cleanup ledgers and integrity/FKs are unchanged. No key was retrieved and no live provider/cloud/hardware was used. Approximately 70% planned implementation, not production readiness. Next: saved draft language targets; external Neon/runtime/provider and broader release gates remain open. Earlier entries are historical.

- Updated (UTC): 2026-10-09 15:09, explicit source transcription retry checkpoint
- S09/A10 now queues blocked/failed accepted source transcription through an explicit confirmed command, preserving the original upload and frozen authority. SQLite/PostgreSQL migration 045 stores immutable actor/site/hash-bound retry receipts, with exact replay, transactional audit rollback and cleanup fences. Client metadata is retained before POST; uncertain outcomes recover by read-only receipt lookup, with explicit same-command resend only after a verified missing receipt. Recovery and history share the control. Backup/restore/cutover preserves retry receipts, including removed audio. Full suite 16208: 533 tests, 530 passed, zero failed, three external PostgreSQL skips (95727.4747 ms), before final receipt-copy/status-refresh refinements. Final strict build, 12 focused passes and 48 shell hashes pass. Native synthetic dev/built checks verify confirmation/cancel, missing provider, before-acceptance resend, lost acknowledgement/reload with one POST/one receipt, 320px/desktop layout, and exact transcript draft navigation. Evidence: artifacts/source-audio-retry-built-mobile.jpg and source-audio-retry-built-desktop.jpg. Main 93436 replaced by synthetic/email-disabled 50452 on 3020/3021; original business hashes/integrity/FKs unchanged. No live provider/cloud/hardware used. Approximately 70% planned implementation, not production readiness. Next: privacy-safe permitted source provider configuration, without allowing real data onto Gemini Free; broader release gates remain open. Earlier entries are historical.

- Final cleanup checkpoint regression: 36 focused tests passed, zero failed (19927.3119 ms) after the scoped mobile layout fix. The first sandbox run hit loopback EACCES; the local-socket-enabled rerun passed without any external service.

- Updated (UTC): 2026-10-09 14:45, source-audio cleanup checkpoint
- S09/A10 now fences and removes abandoned staged source objects after 24 hours and accepted originals/canonical audio under an explicit site audio policy. SQLite/PostgreSQL migration 044 journals partial deletion retries, lease recovery, absence verification and hourly late-write rechecks; receipt/history tombstones stop replay, playback and transcription without removing transcripts/drafts/publications. Backup/restore/import preserves cleanup evidence without requiring removed objects. Full suite 65563 terminal: 524 tests, 521 passed, zero failed, three external PostgreSQL skips (92596.3797 ms), before the final scoped mobile wrapping fix. Final strict build passes (index-CE2q7jYG.js 483.38/131.48 kB gzip); all 47 shell hashes match. Native disposable built fixtures verified removed receipt, stopped pending history, preserved completed draft navigation, two completed source cleanup jobs and corrected 320px wrapping with no page overflow. Rejected a distorted full-page capture; retained normal viewport evidence. Main session/tool handles disappeared during continuation; authoritative port inspection found none running, so synthetic/email-disabled main 93436 was started on 3020/3021. Original 30/25/22/3/5 overview, selected business hashes, empty source/cleanup ledgers and clean integrity/FKs verified. Approximately 70% planned implementation, not production readiness. Next: permitted source provider integration and explicit blocked/failed job recovery; live/cloud/hardware/full-reference gates remain open. Earlier entries are historical.

- Updated (UTC): 2026-10-09 05:40, source-audio client checkpoint
- S09/A10 now connects the native prepared source to exact binary uploads, retaining only an exact-session metadata reference before POST. Receipt recovery is read-only; retries are explicit and verify the same original/canonical bytes and metadata. Reload without bytes disables retry until the original file is selected again. Accepted-only actor/site-scoped paginated upload history preserves blocked/pending/completed receipts while allowing another briefing; completed history links open the exact draft. Native built synthetic fixtures verified acceptance, selected languages, transcription-to-draft, missing provider, interrupted-before-acceptance identical-body retry, lost acknowledgement plus receipt outage with one POST, navigation/reload, continued creation and text-save navigation at 320px/desktop. No real microphone/provider or external storage was used. Full suite 11123 terminal: 515 tests, 512 passed, zero failed, three external PostgreSQL skips (94129.5305 ms). Strict build passes; all 47 shell hashes verified. Main 44758 intentionally stopped/replaced by synthetic/email-disabled 1065 on 3020/3021; native original 30/25/22/3/5 counts, selected business hashes, empty source journal and clean integrity/FKs verified. Disposable fixtures stopped, tabs closed and viewport reset. Approximately 70% planned implementation, not production readiness. Next: staged-object cleanup/source-audio retention and permitted provider retry/integration; live/cloud/hardware/full-reference gates remain open. See docs/SOURCE_AUDIO.md. Earlier entries are historical.

- Updated (UTC): 2026-10-09 05:10, source-audio backend checkpoint
- S09/A10 now has private original/canonical storage, bounded binary HTTP upload, exact session/scope/hash receipts, read-back before acceptance and lost-ack recovery in SQLite/PostgreSQL migration 043. Fenced asynchronous transcription atomically creates one language-bound text draft; missing provider is blocked, never fabricated. Verified backup/restore/import preserves both accepted files and receipts. Twenty-two new focused passes; full suite 70733 terminal: 510 tests, 507 passed, zero failed, three external PostgreSQL skips, 87430.2145 ms. Strict build and 46 shell hashes pass. Main 12006 intentionally stopped and replaced by synthetic/email-disabled 44758, native overview verified at original 30/25/22/3/5; selected business hashes/integrity/FKs unchanged and new source journal empty. Reticle status call unexpectedly installed dev instrumentation; only those timestamp-confirmed generated changes/packages were removed, then strict build/native overview reverified. No Reticle passing verdict claimed. Approximately 70% implementation, not readiness. Audio Save remains disabled pending client recovery/status/native end-to-end work; staged-object cleanup, retention and live/hardware/cloud gates remain. Next: connect exact source upload/recovery in NewBriefing without automatic retries/provider calls. See docs/SOURCE_AUDIO.md. Earlier entries are historical.

- Final verification for the source-audio checkpoint: automatic-stop headroom adjustment followed by passing strict rebuild (index-CYmkGeOc.js, 482.83/131.36 kB gzip), ten focused passes and all 46 public shell hash checks. Actual microphone recording remains untested. Main 12006 and next private-source-journal task below remain current.

- Updated (UTC): 2026-10-09 04:46, supervisor source audio in-progress checkpoint
- Current task: S09/A10 local record/upload preparation and preview now exists, preserving original Blob/canonical bytes with bounded inputs, cancellation and accessible discard/leave controls. Built synthetic-file 320px/desktop, corrupt-replacement and leave/mode/sign-out cancellation checks pass. Audio draft submission deliberately remains unavailable: private original storage/receipts/transcription are not yet implemented. Full suite 85969: 488 tests, 485 passed, zero failed, three external PostgreSQL skips (90.578 sec), before final UI/fixture adjustments; ten later focused passes and strict build/native checks follow. Final capture-stop headroom adjustment pending final build verification below. Fixtures stopped/tabs closed/viewport reset; main earlier process and sockets gone, restored as synthetic/email-disabled 12006 on 3020/3021, original counts and selected business hashes/integrity/FKs unchanged. Approximately 70% implementation, not production readiness. Next concrete task: implement private scoped source-audio journal/storage and exact receipts, then transcription-to-draft worker; do not treat this preview as completing audio input. See docs/SOURCE_AUDIO.md. Earlier checkpoints are historical.

- Updated (UTC): 2026-10-08, site contacts checkpoint
- Current checkpoint: S26 scoped persisted primary/deputy metadata with bounded eligible catalog, revision/replay/audit, legacy omission and migration 042/cutover preservation. Owner/administrator save/reload, search/paging selection, cancel, failed-read refresh/cancel, 320px and desktop native checks verified. Full suite 55447: 485 tests, 482 passed, zero failed, three external PostgreSQL skips (105.173 sec); final selector/fixture fixes followed by strict build and native checks. All 45 current public shell hashes match. Fixture 18677 stopped, QA tab closed and viewport reset. Main 55666 intentionally runs synthetic/email-disabled on 3020/3021, browser-verified at original counts with selected business hashes unchanged, settings/receipt ledgers empty and integrity/FKs clean. Contacts do not grant access or automatically route help. Approximately 70% planned implementation, not readiness. Next: inspect and implement the supervisor audio-source workflow using existing capture/private-storage boundaries; live/cloud/hardware/remaining reference gates remain open. See docs/SITE_CONTACTS.md. Earlier checkpoints are historical.

- Updated (UTC): 2026-10-08, worker access entry checkpoint
- Current checkpoint: localized EN/AR/UR entry with explicit masked fragment redemption, current-session handoff/cancel and exact accepted-session interface preference. Built memory-only native checks verify actual 320px entry, Arabic redemption/reload, frozen English assignment and unchanged identity after canceled Urdu handoff. Correct 1440x1000 desktop evidence replaces a stale capture. Final strict build and full suite 29846 pass: 483 tests, 480 passed, zero failed, three external PostgreSQL skips (112.383 sec); all 38 shell hashes match. Fixture stopped, entry tab closed and viewport reset. Main preview interruption was resolved by verified restart as synthetic/email-disabled 95621 on 3020/3021; original counts and eight selected business hashes/integrity/FKs unchanged. Approximately 70% planned implementation, not production readiness. Delivery, uncertain-redemption recovery, full access/reference/a11y and live/cloud/hardware gates remain. See docs/WORKER_ACCESS_ENTRY.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 18:31, worker interface language checkpoint
- Current checkpoint: worker device settings select EN/AR/UR with bounded exact-session tab persistence and cleanup. UI language stays separate from immutable assignments, request/storage identity and site notice language. Saved draft controls/error states localize independently; recorder notice validation remains tied to server language. Full suite 95834: 483 tests, 480 passed, zero failed, three external PostgreSQL skips (105.467 sec); final notice/direction correction followed by strict build, 21 focused passes and native browser checks. Actual 320px AR/UR/reload/frozen EN content and fresh-session fallback plus desktop AR verified. All 38 shell hashes match. Fixture stopped/tab closed/viewport reset; main 43805 restored with original counts and selected business hashes unchanged. Approximately 70% planned implementation, not readiness. Pre-access localization, saved draft target edits and live/cloud/hardware/reference/accessibility gates remain. See docs/WORKER_UI_LANGUAGE.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 18:20, draft generation languages checkpoint
- Current checkpoint: explicit English-required/Arabic/Urdu creation choices persist in immutable scoped receipts and PostgreSQL migration 041; omission uses site defaults at preparation start. Exact recovery, source edits, backup/cutover and real synthetic preparation preserve the chosen targets without changing publications/history. Full suite: 480 tests, 477 passed, zero failed, three external PostgreSQL skips (108.141 sec). Final UI adjustments follow suite; strict rebuild/native 320px and desktop verification pass. All 38 shell hashes match. A distorted full-page image was rejected and replaced by actual viewport evidence. Fixtures stopped/tabs closed/viewport reset; main 43805 restored/browser-verified at original counts, eight selected business hashes unchanged and relevant ledgers empty. Approximately 70% planned implementation, not production readiness. Editing saved target configuration, worker chooser and live/cloud/hardware/reference/accessibility gates remain. See docs/DRAFT_GENERATION_LANGUAGES.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 17:59, site generation defaults checkpoint
- Current checkpoint: confirmed scoped revision-fenced English-required/Arabic/Urdu defaults persist in SQLite/PostgreSQL migration 040 and backup/import. New preparation captures the selected languages; active runs, prepared/published content and exact-target regeneration keep their original languages. Unsupported recipients fail publication atomically. Readiness separates selection/content/provider evidence and no longer has an unlabeled duplicate Ready badge. Final full suite 10503: 476 tests, 473 passed, zero failed, three external PostgreSQL skips (101.857 sec), preceding only badge removal followed by strict rebuild/native checks. Entry index-Bxj_QcrC.js 479.52/129.79 kB gzip; all 38 shell hashes match. Final built memory-only fixture verifies save/reload/cancel, actual 320px controls and provider-not-tested states. Fixture stopped/tabs closed/viewport reset. Main synthetic/email-disabled preview 21405 restored/browser-verified on 3020/3021 at original counts. Eight selected business hashes/integrity/FKs unchanged; settings/creation/schedule/reminder/read ledgers empty. Approximately 70% planned implementation, not readiness. Per-draft choices, worker chooser, tab-durable settings recovery, live/cloud/hardware/reference/accessibility gates remain. See docs/GENERATION_LANGUAGES.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 17:13, draft creation recovery checkpoint
- Current checkpoint: immutable hash-only creation receipts in SQLite/PostgreSQL migration 039 preserve exact original save replay after edits/archive without duplicating source text. Read-only scoped no-store GET and identity-keyed bounded tab recovery restore original intent after uncertain acknowledgements/reload; explicit retry retains the exact UUID/body. Legacy evidence is not invented. Populated backup/cutover replay preserves edited draft and original receipt. Final full suite 32089: 472 tests, 469 passed, zero failed, three external PostgreSQL skips (268.552 sec). Strict build passes: entry index-CVtleDma.js 478.36/129.45 kB gzip; lazy new form 6.22/2.27; all 38 shell hashes match. Memory-only built browser verifies one lost-ack POST/receipt/audit and a separate before-save interruption with two identical requests yielding one additional draft. Actual 320px screenshot caught retry-button overflow; final CSS fix rebuilt/native-verified after suite. Fixture stopped/tabs closed/viewport reset. Main synthetic/email-disabled preview 4044 restored and browser-verified on 3020/3021 at original 30/25/22/3/5 counts. Eight business hashes/integrity/FKs unchanged; main creation/schedule/reminder/read tables empty. Approximately 70% planned implementation, not production readiness. See docs/DRAFT_CREATION_RECOVERY.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 16:48, publication receipt recovery checkpoint
- Current checkpoint: active scoped SQLite/PostgreSQL GET receipts reconcile exact immediate/schedule acceptance without writes. Bounded identity-keyed tab records retain original complete intent before POST; storage failure prevents sending, mismatch fails closed, reload restores GET-only recovery and explicit absent-receipt retries use the original body/ID. Schedule acceptance is not publication. Five focused checks and related 54 pass. Final full suite 90422: 466 tests, 463 passed, zero failed, three external PostgreSQL skips (85.555 sec). Strict build passes: entry index-UGtMiftI.js 479.71/129.75 kB gzip, 37 shell hashes match. Built browser proves lost acknowledgement/reload/read-only reconciliation with one POST/publication/assignment, corrected fresh-fixture before-save interruption/exact-ID retry with two same-ID POSTs and one publication, and lost schedule acknowledgement resolving one queued schedule without new publication. Actual 320px layouts inspected. An intermediate fixture counter consumed the body; that failed run was corrected and not counted as proof. Fixtures stopped/tabs closed/viewport reset. Main synthetic/email-disabled session 24382 restored/browser-verified on 3020/3021 at original 30/25/22/3/5 counts. Eight business hashes/integrity/FKs unchanged; main schedules/reminders/read receipts empty. Approximately 70% planned implementation, not production readiness. Next: interrupted draft creation; closed-tab/private offline/hardware/cloud/live/reference/accessibility gates remain. See docs/PUBLICATION_RECOVERY.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 16:20, exact-version publication checkpoint
- Current checkpoint: immediate and scheduled publication carry explicit nextVersion and revalidate under the transaction lock, including PostgreSQL post-private-audio reads. Stale confirmations cannot publish a later prepared version with the same revision. Historical versionless receipt replay remains exact; new versionless requests fail. Browser conflict disables the old form; explicit Refresh draft only reads and resets selection/confirmation. Final full suite 53307: 461 tests, 458 passed, zero failed, three external PostgreSQL skips (84.414 sec). Strict build passes; entry index-2AmiesEw.js 478.58/129.65 kB gzip, lazy form 172.56/49.77; all 35 shell hashes match. Final built disposable fixture 38071 verifies two-tab same-revision v1/v2 conflict and read-only refresh, with two POSTs but one publication/assignment, including actual 320px contained controls. Fixture stopped/tabs closed/viewport reset. Main synthetic/email-disabled dev session 67162 restored and browser-verified on 3020/3021 at original 30/25/22/3/5 counts. Eight selected business hashes/integrity/FKs unchanged; main schedules/reminders/read receipts empty. Approximately 70% planned implementation, not production readiness. Next: publication acknowledgement recovery; reminder operations, offline/hardware/cloud/live/reference/accessibility gates remain. See docs/PUBLICATION_VERSION.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 16:03, site-civil-time checkpoint
- Current checkpoint: native publication/deadline fields resolve site time or UTC using pinned Temporal, reject DST gaps and require independent repeated-hour choices. Zone changes clear fields/confirmation. Absolute schedule/reminder instants survive later site-zone changes; history shows numeric offsets. Four focused tests and full suite 52574 pass: 457 tests, 454 passed, zero failed, three external PostgreSQL skips (101.902 sec). Final short-label/error/history display follows suite; strict build/native checks follow these changes. Entry index-CFrCLXt0.js 478.58/129.65 kB gzip, lazy form 172.30/49.70; all 35 shell hashes verified. Fresh memory-only fixture 51687 repeats final actual 320px save: one schedule POST, zero immediate publication POSTs, exact 05:10Z/06:50Z instants, one queued schedule and zero publications/assignments. Fixture terminal, tab closed, viewport reset. Earlier invalid browser inputs made zero POSTs. Eight saved business hashes/integrity/FKs unchanged; main schedules/reminders/read receipts empty. Runtime transition stopped main services; restart remains pending next checkpoint. Approximately 70% planned implementation, not readiness. Next: exact-version immediate-publish fencing; offline/hardware/cloud/live/reference/accessibility gates remain. See docs/SITE_CIVIL_TIME.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 10:30, scheduled library and populated cutover checkpoint
- Current checkpoint: scoped library schedule-state filters and queued UTC timing are implemented in SQLite/PostgreSQL without conflating publication/draft lifecycle. Focused HTTP checks cover all states, current queued priority, bounded paging, privacy, scope and authority. Populated native backup-to-embedded-PostgreSQL cutover preserves all schedule/reminder columns and resumes queued intent exactly once. Full suite 37970 terminal: 453 tests, 450 passed, zero failed, three external PostgreSQL skips (88.866 sec). Strict build passes; final entry index-CyMG8AqW.js 499.61/135.48 kB gzip, all 32 shell hashes verified. Disposable native fixture verifies queue/cancel/library controls and actual 320px contained cancellation layout; one schedule/cancel POST each, zero publication POSTs/publications/assignments. Fixture stopped and tabs/viewport cleaned. Main 14973 intentionally runs synthetic/email-disabled on 3020/3021; native queued-empty/no-schedule-original results and original 30/25/22/3/5 counts verified. Eight selected business hashes/integrity/FKs unchanged; main schedule/reminder/read tables empty. Approximately 69% planned implementation, not production readiness. Next: site-civil-time/DST entry. Reminder operations/retention, complete offline/hardware/cloud/live/reference/accessibility gates remain. See docs/SCHEDULED_LIBRARY.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 10:11, opt-in assignment reminder checkpoint
- Current checkpoint: publication now atomically freezes optional off/60/1440-minute in-app deadline reminders in SQLite/PostgreSQL migration 038, including scheduled publication. Due processing revalidates authority and unanswered/current/unexpired assignment state; immutable outcomes are queued/visible/skipped. Worker inboxes expose only current reminder time, never internal authority or private facts. English/Arabic/Urdu desktop browser checks verify localized reminder/deadline display, processing twice without duplicates and suppression after an accepted synthetic answer. A read-only fixture evidence query initially crashed on an ambiguous SQL column; it was fixed, the memory-only fixture restarted and the full native flow repeated. Focused reminder tests: 8 passed. Full suite 19242 terminal: 450 tests, 447 passed, zero failed, three external PostgreSQL skips (94.223 sec); final deadline/copy/icon/CSS and fixture-query fixes follow it, strict rebuild and browser verification follow those changes. Final entry index-D-jxVfhN.js: 498.74/135.28 kB gzip; 32 public hashes pass. No new mobile or real PostgreSQL concurrency proof. Fixture 67030 terminal and QA tabs closed. Main 10426 intentionally runs synthetic/email-disabled on 3020/3021; browser confirms original 30/25/22/3/5 counts, eight selected business hashes/integrity/FKs unchanged, schedule/reminder/read tables empty. Approximately 69% planned implementation, not production readiness. Next work: scheduled library state; site-civil-time, reminder operations/retention, offline/hardware/cloud/live/reference/accessibility gates remain. See docs/ASSIGNMENT_REMINDERS.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 09:43, durable publication schedule checkpoint
- Current checkpoint: scoped acceptance/cancel/replay, immutable history, frozen content/audience/authority and atomic execution are implemented in SQLite/PostgreSQL migration 037. Durable bounded internal retry is tested. Full suite 64138 is terminal: 442 tests, 439 passed, zero failed, three external PostgreSQL skips (83.402 sec); final frontend native FormData/error/toast fixes follow it and strict rebuild/browser verification follow those fixes. Optimized isolated fixture proves lost acknowledgement/reload/cancel and two due-worker runs yielding one publication/assignment, without any immediate publish POST. Actual viewport override did not apply, so no new mobile proof. Fixture terminal and tabs/override cleaned. Final entry index-D8cbHYBn.js is 497.67/134.95 kB gzip; 32 public hashes pass. Main synthetic/email-disabled service 70063 is intentionally running and browser-verified on 3020/3021, original 30/25/22/3/5 counts and eight selected business hashes/integrity/FKs preserved, notification reads zero, main schedules empty. Approximately 68% planned implementation, not production readiness. Next concrete work: durable in-app reminders and scheduled library state; site-civil-time/mobile/cloud/live/reference gates remain. See docs/PUBLICATION_SCHEDULES.md. Earlier entries are historical.

- Updated (UTC): 2026-10-08 05:17, crew-wide publication selection checkpoint
- Current checkpoint: S12 owner/supervisor read-only crew recipient snapshot, paginated searchable crew catalog and explicit deduplicated selection are implemented in SQLite/PostgreSQL and browser. More than 5,000 members/combined selections are rejected; current scope/role/session/crew revalidate and sanitized HTTP failures never publish. Native fieldset freezes recipient/deadline/confirmation during reading; confirmation clears and failed reads preserve prior IDs. Five focused tests prove 125 members, privacy/scope/revocation/read-only/bounds, unchanged selected audience after membership changes and exact publish replay. Full suite 13893 terminal: 433 tests, 430 passed, zero failed, three external PostgreSQL skips (78.917 sec); only final icon/max-width CSS follows it, strict rebuild/final browser follow CSS. Optimized fixture 20171 proves catalog paging/search, 125 selected despite one-worker filter, deduplication/reconfirmation, individual removal, held-read failure and manual recovery; actual viewport stayed 1280 despite override, so no new mobile proof claimed. Fixture cache/tabs/override cleaned, service stopped; draft publications/assignments remain zero. Verified-live main 4576 intentionally restarted as synthetic/email-disabled 46295 on 3020/3021. Eight selected business hashes/integrity/FKs and zero notification reads match. Final main 495.99/134.43 kB gzip, all 31 public hashes verified (index-IoGnr29v.js). Approximately 67% planned implementation, not readiness. Scheduling remains unimplemented; next concrete task: durable schedule acceptance/cancel/replay plus execution-time authority, revision, deadline and frozen-recipient revalidation. See docs/BRIEFING_PUBLICATION.md. Earlier runtime IDs/checkpoints are historical.

- Updated (UTC): 2026-10-08 04:59, report publication-history checkpoint
- Current checkpoint: S16/A15 has scoped metadata-only title/civil-publication-date paging in SQLite/PostgreSQL and a lazy native-form picker beyond the old 100-version UI ceiling. Frozen audience/assignment-language/latest-evidence metrics and export semantics stay unchanged; no response-window/crew filter is claimed. Full suite 52756 is terminal: 428 tests, 425 passed, zero failed, three external PostgreSQL skips (76.713 sec). Only final CSS/singular copy follow the suite; strict rebuild and browser checks follow them. Optimized fixture 41019 verifies seven pages/126 versions, keyboard oldest-version selection/two original assignees, retained submitted dates, empty future range, contained fields at actual 320px, failed GET/manual retry, failed lazy download and surviving navigation/recovery. Fixture cache/tab/viewport cleaned and 3168/3169 closed. Verified-live main 8700 intentionally restarted as synthetic/email-disabled 4576 on 3020/3021; new history endpoint and singular label work. Eight selected business hashes/integrity/FKs unchanged, notification reads remain zero, actual counts 30/25/22/3/5 preserved. Final build main 492.40/133.67 kB gzip, all 31 public hashes verified (index-BiS57SJO.js); no cloud/provider/email/real-data actions. Approximately 67% planned implementation, not readiness. See docs/REPORTS_IMPORTS.md. Next concrete task: inspect scheduling contracts against existing publication authority/audience/replay handling before implementation. Earlier runtime IDs/checkpoints are historical.

- Updated (UTC): 2026-10-08 04:34, staff inbox and cross-tab audio checkpoint
- Current checkpoint: metadata-only owner/supervisor/auditor site notifications reuse eight audit event kinds, with exact credential/site revalidation, stable bounded all/unread paging and immutable original per-staff read receipts. SQLite/PostgreSQL migration 036 and synthetic backup/import preserve receipt authority/timestamps. Lost-acknowledgement optimized fixture 82907 proves one read POST/receipt, refresh/reload reconciliation, zero worker POSTs and real queue navigation. Final 320px build fixes label clipping, exposes a 44px mobile bell and removes its fake unread dot. Native two-tab audio fixture 6140 proves explicit removal invalidates the other saved preview without resending after one accepted/lost audio acknowledgement and withdrawal. Final suite 15586: 423 tests, 420 passed, zero failed, three external PostgreSQL skips (76.707 sec); final CSS follows the suite, strict rebuild/browser checks follow CSS. Main 499.76/135.19 kB gzip, all 30 public hashes verified. Fixtures stopped, public fixture cache/tab/viewport cleaned and exact native temporary audio removed. Verified-live main 66921 intentionally restarted as 8700 on 3020/3021, synthetic/email-disabled; eight selected business hashes/integrity/FKs unchanged, existing inbox read receipts remain zero. Approximately 67% planned implementation, not readiness. Email/push/reminders, notification receipt retention, complete offline/hardware/cloud/live/reference/accessibility gates remain. See docs/NOTIFICATIONS.md and docs/WORKER_AUDIO_RECOVERY.md. Earlier runtime IDs/checkpoints are historical.

- Updated (UTC): 2026-10-08 04:03, credential cleanup evidence and service reconciliation
- Credential-mode follow-up: disposable --built --credential fixture 10359 proves denied IndexedDB cleanup stops worker switching after confirmed logout but before redeeming the original new-worker token (zero auth/worker POSTs; grant unredeemed). Explicit storage recovery/removal then allows exactly one redemption. Staff credential login after reload likewise sends no authentication request during cleanup failure and succeeds once after removal. No attempts/recordings/provider/email writes. Initial harness launch failed before listening due to absent credential-mode demo seeding, repaired with explicit memory-only seed; production behavior unchanged. Application/build still match final suite 45004 (416 tests, 413 passed, zero failed, three external PostgreSQL skips), 29 hashes reverified. Fixture cache/tab/viewport cleaned; later missing handles and authoritative empty ports confirmed fixture/main stopped. Main restored as 66921 on 3020/3021, synthetic/email-disabled; eight selected business hashes/integrity/FKs unchanged. Approximately 66% planned implementation, not readiness. Hardware, complete offline outbox, shared-device races, cloud/live/reference/accessibility gates remain. See docs/WORKER_AUDIO_RECOVERY.md. Earlier runtime IDs are historical.
- Updated (UTC): 2026-10-07 20:35, cleanup-boundary failure verification
- Current follow-up: new sign-in checks local cleanup before any authentication POST, including after reload; cleanup failure blocks profile/credential actions until confirmed explicit removal. In-flight guard covers authentication/logout/removal; AR/UR logout warnings preserve language and the generic Saved toast is removed. Disposable optimized fixture 85523 injects IndexedDB-open denial: final index-C0SrhwjA.js shows persistent RTL warnings at 320px, disabled new sign-in and zero auth/worker POSTs after denied cleanup/reload. Visible QA storage recovery alone does not clear the warning; Remove succeeds, then exactly one synthetic sign-in opens Worker 029. This is not credential-mode browser/hardware/cross-browser certification. Final full suite 45004: 416 tests, 413 passed, zero failed, three external PostgreSQL skips (78.05 sec); strict build main 499.26/135.06 kB gzip and all 29 public hashes pass. Fixture stopped/public cache removed/tab closed/viewport reset; only main 3020/3021 ports remain. Main 32358 live, eight selected business hashes/integrity/FKs unchanged. Actual 30-second checkpoint pause completed and work resumed with this fix. Approximately 66% planned implementation, not production readiness. See docs/WORKER_AUDIO_RECOVERY.md. Earlier checkpoints are historical.
- Updated (UTC): 2026-10-07 20:26, opt-in encrypted audio recovery
- Current checkpoint: native IndexedDB/AES-GCM holds one consent-gated exact-session/version canonical recording with original ID, bounded expiry, compare-and-replace and verified readback. Explicit foreground Send/GET receipt/Remove; no background upload. Localized failures preserve previews, independent device cleanup survives the saved-panel bundle failing, and logout cleanup warns persistently when unconfirmed. Native generated-tone browser/API proof shows one decode/POST/recording/receipt despite lost acknowledgement and withdrawal, reload restoration and removal; this is not hardware capture. Final optimized index-B9vXrPK7.js EN/AR/UR controls fit at actual 320px. Final suite 14030: 416 tests, 413 passed, zero failed, three external PostgreSQL skips (80.84 sec). Strict build 41957 passes, main 498.92/135.01 kB gzip, 29 public hashes verified. Fixtures stopped, public cache/tabs cleaned, viewport reset, native temporary audio removed and QA ports closed. Main 32358 restored after authoritative missing-handle/empty-port evidence, live on 3020/3021; eight selected business hashes/integrity/FKs unchanged. Approximately 66% planned implementation, not production readiness. Full offline outbox, actual microphone/phone, cloud/live/reference/accessibility gates remain. See docs/WORKER_AUDIO_RECOVERY.md. All earlier checkpoints are historical.
- Updated (UTC): 2026-10-07 16:41, foreground canonical audio retry
- Audio retry checkpoint: recorder freezes the first prepared WAV and original submission ID, returning isolated byte copies on retry. Client reauthorizes session, reads the original audio receipt, then verifies fresh exact assignment/publication/version/language/deadline/response state before a new POST. Accepted history returns without resending after withdrawal or assessment failure; unavailable reads/conflicts fail closed, uncertain POST retains preview/ID. Actual synthetic API and native browser generated-tone fixture 86966 prove one decode/POST/recording/receipt and recovered original acceptance after withdrawal. This native check uses Vite source modules, not a hardware microphone or the optimized app. Final --built fixture 5984 loads final index-DhaEqd-K.js/recorder/site notice and corrected EN/AR/UR browser-restore privacy copy. Actual follow-up AR/UR viewport was 1280px; override did not take effect, no new 320px proof claimed. Final full suite 8766 terminal: 407 tests, 404 passed, zero failed, three external PostgreSQL skips (90.70 sec). Strict build main 495.16/134.10 kB gzip without warning; 27 public hashes verified; standalone browser test TS passes. Both fixtures stopped/tabs closed/public fixture cache removed/override reset; verified temporary native audio root removed after process termination, four fixture ports empty. Main 98032 remained live, eight selected business hashes/integrity/FKs unchanged, browser returned to Maya. Approximately 65%; no durable audio outbox/offline/hardware/live/cloud readiness claim. See docs/WORKER_AUDIO_RETRY.md. Earlier checkpoints below are historical.
- Final optimized follow-up: the earlier fixture run used development mode, caught during evidence review. Repeated actual --built fixture 49562 proves EN lost-acknowledgement save/reload/original-ID restore/GET with one POST/one attempt/one GET, AR/UR exact text reload restoration at 320px, cross-worker isolation, snapshot removal preserving current text, updated leave warning and device removal. Final screenshot names use worker-text-built-*.jpg. Optimized public shell available, installation not offered; fixture-owned public cache removed through UI, QA tab closed, viewport reset, 49562 stopped. Earlier unavailable-shell statements refer to development mode. Final strict build/hash evidence unchanged, no additional source edit or saved business write. Approximately 65%; offline audio/outbox and production gates remain open.
- Tab text checkpoint: explicit opt-in bounded plaintext sessionStorage snapshots restore answer/help text and optional original receipt IDs only for the same verified worker/context/expiry and exact assignment/publication/version. No automatic POST; malformed/storage failure/expiry/scope change fail closed. Restore cannot overwrite newer text, receipt tracking or unsent audio. Remove leaves current text intact and is available on briefing/device screens. SQLite detail publication ID brought into parity with PostgreSQL after browser testing correctly failed closed on its absence. Built EN/AR/UR reload restores exact text; AR/UR 320px bounds fit; cross-worker restore exposes nothing. Lost synthetic acceptance acknowledgement survives save/reload/manual restore/GET with one POST/one attempt/one receipt GET. Latest full suite 61949 terminal: 397 tests, 394 passed, zero failed, three external PostgreSQL skips (94.16 sec). This precedes only final leave/privacy wording and device removal control; final related subset passes 26 checks. Final strict build passes without warning, main 490.80/133.27 kB gzip, all 27 public hashes match. Verified-live main 67581 intentionally restarted as 98032; eight selected business-table hashes/integrity/FKs match. Fixtures 70084/58695 stopped, QA tab closed, viewport reset; this browser reported public shell/install unavailable, no cache removal or hardware action claimed. Approximately 65% planned implementation, not production readiness. Plaintext tab storage is not a secure vault, closed-tab guarantee, private offline workspace or durable audio outbox. See docs/WORKER_TEXT_DRAFTS.md. Earlier checkpoints below are historical.
- Manual receipt checkpoint: scoped SQLite/PostgreSQL GET lookup returns minimal answer/help/audio acknowledgements for exact original IDs, including accepted closed versions. It reauthorizes worker/grant/session and rejects wrong kinds, foreign scope, query overrides and unreceived staging rows. No new schema or evidence rewrite. Worker UI tracks the latest in-flight/uncertain request per kind in page memory and offers localized GET-only Check receipt; success/404/failure never clear or resend drafts/audio. Older uncertainty is cleared only after a verified receipt. Built English lost-acknowledgement acceptance resolves with one POST/one attempt/one GET and preserves a newer unsent draft. Arabic help resolves without resubmission; Urdu missing lookup and final English 503 remain unknown with drafts intact. Mobile screenshot exposed cramped generic notice flex layout; dedicated single-column notice now fits AR/UR at 320px, screenshots/DOM bounds verified. Full final suite 53474 terminal: 390 tests, 387 passed, zero failed, three external PostgreSQL skips (75.86 sec); focused 53 and final 12 pass. Strict final build passes without warning: main 488.90/132.84 kB gzip, all 24 public hashes match. Fixture 39227 intentionally replaced by 54437 for final outage test; fixture public cache removed/tab closed, viewport reset, 54437 stopped. Verified-live main 96186 intentionally restarted as 67581; saved eight selected business hashes/integrity/FKs match. Approximately 65% planned implementation, not readiness. Tracking is not durable across reload/navigation, no recoverable private outbox/offline capture/background upload or actual microphone proof; live/cloud/reference/a11y gates remain. See docs/WORKER_REQUESTS.md. Earlier checkpoints below are historical.
- Exact audio receipt checkpoint: SQLite/PostgreSQL upload HTTP acknowledgements include original request ID, assignment and verified page context. Client validates those fields, accepted status and strict receipt timestamp before recorder success. Rejected/malformed acknowledgements leave the recorder preview on its existing retry path. A legacy route-only test lacked a real session; corrected to create/validate an actual synthetic session, with context derived before any audio write. Latest full suite 53852 terminal: 387 tests, 384 passed, zero failed, three external PostgreSQL skips (87.65 sec); prior 69275 had that one fixture failure and is superseded. Eleven final focused checks pass, plus prior 49 backend/client checks. Strict audio build passes without warning: main 485.84/131.99 kB gzip; all 24 public hashes match. Verified-live main 62312 intentionally restarted as 96186 on 3020/3021; saved eight-table hashes/integrity/FKs unchanged, refreshed browser Maya overview 30/25/22/3/5. No hardware microphone/actual browser audio upload proof, private outbox, receipt lookup, cloud/provider or production readiness claim. Approximately 64%; next work is read-only request reconciliation before durable offline storage. Earlier checkpoints are historical.
- Final post-POST expiry wording follow-up: eleven focused worker/session checks pass; strict final build passes without warning (485.45/131.90 kB gzip) and all 24 public hashes match. Build 72357 is terminal. Full suite 31195 below remains the latest full run and precedes only this wording change. Main 62312 is the current synthetic/email-disabled preview; goal remains active at approximately 64%.
- Exact receipt follow-up: SQLite/PostgreSQL HTTP return verified page context, original request ID and exact assignment on answer/help success and replay. Client requires matching identity and valid outcome before clearing text; a post-POST expiry stays uncertain. Fifty-five focused backend/client checks pass; full suite 31195 terminal: 386 tests, 383 passed, zero failed, three external PostgreSQL skips (104.41 sec). Build main 485.45/131.90 kB gzip and 24 public hashes match; these results precede only the final post-POST expiry error-code wording correction. Built wrong-assignment receipts preserve both texts without stored attempt/audio; actual in-memory English answer/Arabic help successes confirm valid contract. No saved business submission. Fixture public cache/tab cleaned; 52038/85860 handles missing and all app/fixture ports stopped at continuation, so main restored as 62312. Eight selected saved hashes/integrity/FKs match; synthetic Maya overview restored. Approximately 64%, not readiness; no durable private outbox, receipt lookup/reconnect/conflict or live rollout claim. See docs/WORKER_REQUESTS.md. Earlier checkpoints below are historical.
- Worker request checkpoint: typed answers/help retain IDs in one bounded opaque-context tab ledger, fail closed on malformed/full/blocked storage and check success acknowledgements. Exact rejected retries reuse the original body; invalid acknowledgements preserve text and remain uncertain. Built EN/AR/UR corruption checks retain both texts without POST; final RTL 320px/focus checks pass. Lazy Billing failure stays in the staff shell; fresh success loads the empty list without writes. Full suite 90937 terminal: 385 tests, 382 passed, zero failed, three external PostgreSQL skips (106.01 sec). Strict build passes without warning: main 485.10/131.81 kB gzip, Billing 19.92/5.82. All 24 public hashes match. Fixtures 58586/59524/66915 stopped; caches/tabs cleaned and viewport reset; main 28667 live, synthetic Maya overview restored. Approximately 64%, not readiness. This ledger is not an outbox; typed receipt exact identity, private offline/shared-device/reconnect/conflicts and live gates remain open. See docs/WORKER_REQUESTS.md. Earlier checkpoints below are historical.
- Public-shell/device checkpoint: optimized builds generate an anonymous, integrity-checked cache of public HTML/manifest/icons/JS/CSS only. Private APIs/audio, query-bearing access links, writes and Authorization requests bypass it; runtime responses are never added. EN/AR/UR device views expose truthful shell/install availability, expiry and public-cache removal. Built 320px RTL/English checks pass after fixing the new header overflow. Fixture-only root/API 503 outage opens the public app but not an unverified worker workspace. Failed device-chunk download is contained with working inbox recovery and fresh success. Eight focused worker checks pass; final full suite 81955 terminal: 379 tests, 376 passed, zero failed, three external PostgreSQL skips (105.15 sec). Strict build passes without warning: main 499.71 kB / 134.71 kB gzip; device 5.78 kB / 2.39 kB gzip. All 23 final public build hashes independently verified. Fixtures 92016/94263 stopped, QA tabs closed, viewport reset; main 28667 live and synthetic Maya preview restored. Fixture counters show no worker/logout POST, attempt or recording. No microphone, OS installation, real private content, provider or cloud action. Approximately 64% planned implementation, not production readiness. Private offline/cache/outbox, shared-device/reconnect conflicts, hardware, all-reference/a11y and live/deployment gates remain open. Reticle remains unconnected; no Reticle verdict. See docs/PUBLIC_SHELL.md. Earlier checkpoints below are historical.
- Client mount follow-up: moved the one-time createRoot call to src/entry.tsx and exported App from the existing main module. After a fresh entry load, an actual App-module hot update preserves the Worker 014 search/filter state; no new browser console errors or dev invalidation/root warning. Optimized fixture loads the worker and lazy recorder/notice with an empty error/warning log. Strict build passes without warning (main 496.43 kB / 133.75 kB gzip); eight focused checks pass. Latest full suite remains 49034, 371/368 pass/zero fail/three skips, and predates only this mount relocation/comment. Fixture 17683 stopped and tab closed; main 28667 remains live, staff preview restored. No saved business-data mutation, microphone, provider or cloud operation. Screenshot artifacts/deletion-ui/dev-hmr-state-preserved.jpg. Estimate remains approximately 63%, not readiness. Resume with broader session/shared-device conflict handling and bounded offline/PWA requirements; reference/hardware/accessibility/live/deployment gates remain open. Earlier checkpoints below are historical.
- Initial session recovery follow-up: failed initial session reads render an EN/AR/UR recovery state instead of an indefinite loading screen; manual retry is GET-only, validates the existing site-session DTO and aborts obsolete reads. Built worker and staff failure/recheck checks pass. Fixture evidence workerPosts/logoutPosts/attempts/recordings all zero; worker path made three session reads (failed initial, manual retry, worker guard). Eight focused tests pass; full suite 49034 terminal: 371 tests, 368 passed, zero failed, three external PostgreSQL skips (104.44 sec). Strict build passes without warning: main 496.43 kB / 133.75 kB gzip. Fixture 99985 stopped and temporary tab closed; main 28667 verified live, staff preview reloaded/restored. No backend/schema/cloud/provider operation. Estimate remains approximately 63%, not readiness. Reticle still has no connected app, so no Reticle verdict. Dev log reveals the existing main-entry hot-reload duplicate-createRoot/invalidation warning; next fix should separate the React mount entry from the App module, then verify built/dev behavior. Broader offline/PWA, full conflict/session isolation, hardware, reference/a11y and live/deployment gates remain open. Earlier checkpoints below are historical.
- Worker refresh-recovery checkpoint: network/5xx failures retain an already loaded exact assignment only while unsent work exists. A localized alert and manual refresh are available; answer/help sending and recorder start/send are disabled until a successful recheck. Permission/other 4xx failures do not retain the protected detail. Built EN/AR/UR checks preserve exact typed/help drafts through failure and manual recovery; Arabic recorder view remains present but disabled, and AR/UR fit at 320px. Built 403 check removes briefing/recorder/forms. No actual microphone preservation claim. Five focused checks pass; full suite 61259 terminal: 371 tests, 368 passed, zero failed, three external PostgreSQL skips (101.81 sec). Strict build passes without warning: main 495.24 kB / 133.44 kB gzip, recorder 13.80 kB / 5.41 kB gzip. Fixture 58887 terminal and tab closed/viewport reset; counters workerPosts/logoutPosts/attempts/recordings all zero. Main 28667 remains intentionally running, no backend change/restart required. Approximate completion remains 63%, not readiness; changed successful detail responses, real capture, native unload, durable offline, external PostgreSQL/cloud/provider and full reference/accessibility gates remain open. See docs/WORKER_UNSENT.md. Earlier checkpoints below are historical.
- Worker navigation checkpoint: same-page hash/browser-back changes use the existing localized unsent-work confirmation; cancellation retains the draft, confirmed navigation leaves once, and in-flight submissions hold the current route and disable answer/help editing. Successful worker logout clears the route; rejected logout retains the draft and restores normal leave protection. Built-browser checks cover English browser Back/hash/cancel/confirm, Urdu hash/cancel/confirm, final logout success/rejection and held submission rejection. Lazy Activity view contains a failed chunk and loads real filters/events after a fresh successful load. Full suite 24265 terminal: 370 tests, 367 passed, zero failed, three external PostgreSQL skips (98.04 sec). Strict build passes without warning: main 493.99 kB / 133.10 kB gzip, Audit 6.55 kB / 2.14 kB gzip. Final disposable counters: one rejected worker POST, two logout POSTs, zero attempts/recordings; no microphone or provider use. Fixture 30415 stopped and temporary tabs closed. Main 62307 was missing after continuation, with no 3020/3021 listeners; preview restored as 28667, synthetic health verified and selected saved-table hashes/integrity/FKs unchanged. Whole-build estimate approximately 63%, not readiness. External/native navigation, full history fidelity, durable offline/audio, conflict recovery, hardware, cloud/provider and full reference/accessibility gates remain open. See docs/WORKER_UNSENT.md. Earlier checkpoints below are historical.
- Worker session-isolation checkpoint: opaque page contexts and expiry are exposed without returning cookie/token hashes; SQLite/PostgreSQL HTTP require matching contexts before worker answer/help/audio/logout mutations, and reject a supplied stale context on reads or staff logout. Worker inbox/detail reads bind their page context. Same-origin signals, foreground/online checks, visible polling, mount checks and expiry lock/unmount an old worker page without adopting another identity. Built-browser checks prove English cross-tab draft clearing/new-worker isolation, Arabic expiry and Urdu failed verification; no microphone or worker submission. Repeated fixture evidence: zero worker POSTs/attempts/recordings. A fixture-only evidence-query column error was repaired and the fixture/repeated checks completed. Full suite terminal: 369 tests, 366 passed, zero failed, three external PostgreSQL skips (77.08 sec); strict build passes without warning, main 499.21 kB / 133.75 kB gzip. Fixtures 3775/84631 terminal, QA tabs closed and viewport reset. Verified-live main 45752 was intentionally replaced by 62307 on 3020/3021; synthetic health and selected saved-table hashes/integrity/FKs match. Synthetic staff preview restored. Whole-build estimate approximately 62%, not readiness; durable offline/PWA, full navigation/hardware/staff cross-tab behavior, external concurrency, reference/a11y and provider/deployment gates remain unfinished. See docs/WORKER_SESSION.md. Earlier checkpoints below are historical.
- Recorder loading/unsent-work checkpoint: recorder code is now lazy with localized loading/error containment; the rest of the worker page and typed fallback remain usable after a failed production-chunk download. Built-app fixture checks EN/AR/UR failure and fresh success without microphone access. Worker Back/End session warn about unsent typed answers/help/audio, mode changes warn before dropping audio, upload-busy controls are disabled and a native beforeunload warning is registered. Same verified-assignment loading refresh retains unsent work. Built-app cancellation checks preserve typed/help drafts, Escape/Shift+Tab focus and EN/AR 390px plus Urdu 320px fit; actual microphone-state cancellation, browser-native beforeunload behavior, hash/browser-back/cross-tab identity changes and durable offline storage are not verified or complete. Full suite terminal: 366 tests, 363 passed, zero failed, three external PostgreSQL skips (73.61 sec). Strict build passes without the chunk warning: main 494.05 kB / 132.12 kB gzip; recorder 13.77 kB / 5.40 kB gzip. Fixture 31931 stopped, QA tab closed, viewport reset; main 45752 remains intentionally running. No saved worker data, policy, deletion, microphone or provider operation. Estimate remains approximately 61%, not readiness. See docs/WORKER_UNSENT.md. Earlier checkpoint warnings are historical.
- Site recording-notice checkpoint: scoped owner/admin EN/AR/UR configuration, current-worker-language-only reads, explicit confirmation, revision checks and immutable original-actor receipts are implemented in SQLite/PostgreSQL migration 035. Tab-local original intent survives reload; failed acknowledgement requires a receipt read and fresh manual confirmation, never automatic POST. Payload scope binds the original organization/site/actor even if the cookie changes. Worker recording remains disabled until a valid notice read and shows custom content as plain text. Synthetic browser checks prove failure/retry gating, language-specific display, literal markup, rejected-save exact replay/reload and 320/390px plus desktop fit; no microphone or audio upload. Non-writing fixture evidence reports two exact POST attempts and unchanged revision 1; actual PostgreSQL lost-after-commit recovery is separately covered by tests. Full suite is terminal: 365 tests, 362 passed, zero failed, three external PostgreSQL skips (75.18 sec). Strict build passes; main 506.10 kB / 136.15 kB gzip still warns, lazy notice editor 4.16 kB. Fixture 70871 stopped, QA tab closed and viewport reset. Main 3142 was verified live and intentionally replaced with 45752 on 3020/3021; health is synthetic-demo, existing selected data hashes match, integrity is ok, FK errors zero, notice policy/receipt and deletion request/completion counts zero. Approximate completion 61%, not production readiness. Real PostgreSQL concurrency, customer wording/legal review, broader retention, offline/PWA, provider/cloud and full reference/accessibility gates remain unfinished. Earlier checkpoints below are historical.
- Recording notice follow-up: localized EN/AR/UR text now appears before microphone activation and covers memory-only unsent audio, explicit send, private authorized-staff access, synthetic-versus-configured AI processing and retention/backup/device limits. No legal-consent or fixed-period claim is made. Disposable browser checks verify all three texts, EN/AR/UR 390px fit and Urdu 320px/desktop fit without requesting microphone access or sending audio. Latest full suite is terminal: 360 tests, 357 passed, zero failed, three external PostgreSQL skips (72.64 sec). Strict build passes with a main-chunk size warning: 501.68 kB / 134.88 kB gzip. Notice configuration is not yet site-specific; that and durable unsent/offline audio remain outstanding. Fixture 36949 is stopped, QA tab closed and viewport reset. Approximate completion stays 60%.
- Local service follow-up: old handle 27397 was live and intentionally stopped to load the new privacy API. Main synthetic-only preview now runs as session 3142 on 3020/3021; proxied health returns synthetic-demo. Read-only database checks before and after restart show integrity `ok`, zero FK errors and zero deletion requests/completions. Disposable fixture 84554 is stopped, its QA tab closed and viewport reset. Reticle session listing remains empty; its narrow port scan excludes 3020 and is not evidence that the verified service is down.
- Administrator privacy checkpoint: owner/admin settings now expose a bounded, site-scoped metadata-only worker list with literal search, stable paging and queued/completed filters. SQLite and PostgreSQL HTTP coverage includes more than 100 workers, foreign-scope denial and administrator acceptance. Client receipts bind the selected worker and exact request UUID and reject malformed or contradictory completion evidence. An uncertain submission requires a successful status read and renewed explicit confirmation before retrying the original unchanged body. Disposable browser QA verifies two rejected submissions used identical bodies, refresh/cancel/reload caused no automatic POST, the target remained active and the fixture retained only its two setup requests. This is non-writing rejection UI evidence; actual lost-after-commit recovery is separately covered by HTTP tests. Administrator queued/completed views and 390px geometry pass; screenshots are in artifacts/deletion-ui/admin-*.jpg. Full suite: 359 tests, 356 passed, zero failed, three external PostgreSQL skips (72.96 sec). Strict build passes: main 498.54 kB / 133.56 kB gzip, lazy PrivacyWorkers 3.96 kB and WorkerDeletion 6.94 kB. Whole-build estimate approximately 60%, not production readiness. External concurrency/restore, broader feature coverage and deployment gates remain unfinished; legal holds require a separate policy decision, not an assumed spec requirement.
- Recovery/service follow-up: after the requested 30-second pause, both disposable HTTP backends pass injected connection-loss-after-commit tests; a read-only lookup recovers the exact UUID receipt and exact replay cannot duplicate cleanup. The 354-pass full suite below predates these added assertions; application code is unchanged. Old main process handle 16614 was unavailable and authoritative port inspection found no 3020/3021 listeners. A read-only saved-database check proved integrity `ok`, zero FK errors and zero deletion requests before launch. Updated synthetic-only/email-disabled main preview is running as session 27397 on 3020/3021; proxied health returns HTTP 200 synthetic-demo. Post-launch read-only checks still report zero requests/completions, intact integrity and zero FK errors. The disposable browser fixture was explicitly stopped, its tab closed and viewport reset. Overall estimate remains approximately 59%.
- Deletion completion checkpoint: migration 034 and immutable SQLite receipts record `worker.deletion.completed` only after a fresh cleanup/access/content/snapshot check and definite private-object absence. Permission failures, retained objects, missing verification support and changes during storage I/O cannot produce completion; audit failure rolls back the receipt. PostgreSQL final writers serialize by request before rechecking. Native backup-to-PostgreSQL cutover preserves completed markers. Scoped owner/admin GET/POST worker deletion endpoints require confirmation, exact worker label, origin and active authority; no private label/digest is returned in status. Worker-detail UI adds confirmation, queued/completed stage dates, manual read-only refresh and no automatic resubmission after an uncertain outcome. Controls load lazily (5.64 kB); main bundle 498.44 kB / 133.51 kB gzip. Full loopback-enabled suite is terminal: 357 tests, 354 passed, zero failures, three external PostgreSQL skips (79.51 sec). Strict build passes. In-memory synthetic browser fixture verifies checkbox gating/cancel, queued re-enable/resubmission suppression, completed receipts and 390px layout; screenshots are in artifacts/deletion-ui. No destructive browser submission or existing local deletion occurred. Reticle still has no connected session, so its gate has no passing verdict. Main service was not restarted for these edits. Estimate approximately 59%; holds, full interrupted-request browser proof, real PostgreSQL concurrency, independent DB/object restore and wider feature/deployment gates remain unfinished.
- Pseudonym follow-up: nine focused pseudonym/cutover checks pass, including Arabic/supplementary Unicode digest matching, the 80-character worker-label bound and organization-isolated reuse. The 348-pass full suite below predates these added assertions, but implementation is unchanged. Requested 30-second pause completed and work resumed. Estimate remains approximately 58%.
- Worker pseudonymization checkpoint: migration 033 and SQLite guards freeze requested worker identity, reserve its old label by scoped SHA-256 digest and allow only the audited switch to an opaque `Deleted <UUID>` label after redaction/audio/snapshot/access cleanup. Crew membership is removed atomically; receipt/history IDs and outcomes remain. Export creation takes ordered PostgreSQL worker locks and rejects pending cleanup, while fresh post-pseudonym exports contain the opaque label. Import preview locks matching identities and checks bounded filename/row digests without retaining old labels; SQLite validates inside its immediate write transaction. Synthetic backup/cutover preserves the marker, label and reservation. Full loopback-enabled suite: 351 tests, 348 passed, zero failures, three external PostgreSQL skips (78.18 sec). Strict build passes. No existing worker deletion submitted or main-service restart. Whole-build estimate approximately 58%; final completion verification/API/UI, holds, real concurrency/restore and remaining feature/deployment gates are unfinished.
- Import metadata checkpoint: migration 032 and SQLite upgrade replace matching import filenames with `[Deleted].csv`, retain only their SHA-256 digest for exact request replay, and clear rows/errors atomically with a one-time deletion audit. Matching includes previously expired filenames and post-request uploads, scoped to the organization; unrelated imports remain usable. Sanitized receipts cannot restore names/digests or become usable again. Synthetic native backup-to-PostgreSQL cutover preserves minimized filenames/digests; legacy source columns remain accepted. Full loopback-enabled suite completes 349 tests, 346 passed, zero failures, three external PostgreSQL skips (72.08 sec); strict build passes. Reticle has no connected session, so no browser verdict is claimed. No existing worker deletion submitted. Estimate remains approximately 57%; current worker-label pseudonymization, final deletion verification/API/UI and wider production gates remain unfinished.
- Legacy receipt follow-up: insertion of a fresh reactivation receipt for a deletion-requested worker is now fenced at the database boundary; SQLite trigger upgrades avoid repeating DDL on every sweep. Synthetic native backup-to-PostgreSQL cutover explicitly preserves sanitized legacy labels. All 22 affected checks pass after this follow-up; the 344-pass full suite immediately below predates these final fence/cutover assertions. Requested 30-second pause completed and work resumed. No existing local deletion was submitted; estimate remains approximately 57%.
- Legacy deletion receipt checkpoint: worker reactivation rejects deletion requests before replaying old acknowledgements. SQLite and PostgreSQL migration 031 allow only scoped `[Deleted]` label removal from legacy reactivation receipts, preserving identity/date/actor fields and immutable history. Cleanup is audit-atomic and repeat-safe, with unrelated worker/crew receipts protected. Focused checks pass 22/22; full loopback-enabled suite completes 347 tests, 344 passed, zero failures, three external PostgreSQL skips (95.36 sec). Strict build passes. No existing worker deletion submitted. Estimate remains approximately 57%; current worker labels, import metadata, final verification/API/UI and wider production gates remain unfinished.
- Relational deletion content checkpoint: immutable scoped redaction-stage receipts, guarded answer/help/clarification removal, audio/snapshot prerequisites, atomic audit rollback and replay protection are implemented in SQLite/PostgreSQL migration 030 and both worker pipelines. Cutover preserves redacted text/receipts; a discovered legacy SQLite reasons-object conversion bug is fixed while preserving non-redacted evidence in PostgreSQL arrays. Full permission-enabled suite completes with 345 tests, 342 passed, zero failures, three external skips (78.12 sec); strict build passes. No existing deletion request submitted. Whole-build estimate remains approximately 57%; label/reactivation/import metadata minimization, final deletion completion, API/UI and wider production gates remain unfinished.
- Import deletion scope follow-up: all five deletion scenarios pass after adding same-organization cross-site and foreign-organization matching-label fixtures. The former is purged, the latter and unrelated labels stay usable. Tests use disposable synthetic databases only.
- Deletion import snapshot checkpoint: matching pre-request CSV previews expire on access or sweep, clear rows/errors, refuse confirmation and audit the deletion purge once. Same-organization matching covers stored label copies; unrelated imports remain usable. Migration 029 preserves immutable request identity. Eighteen affected deletion/import/migration/HTTP/cutover checks pass. The prior full suite predates these edits. Filenames and other retained metadata still need final minimization, with relational redaction and pseudonymization unfinished. No existing deletion request submitted; estimate remains approximately 57%.
- Deletion export cleanup checkpoint: SQLite and PostgreSQL invalidate affected pre-request export snapshots/CSV/checksums, cancel leases and append a one-time deletion-purge audit. PostgreSQL completion rechecks deletion after rendering; unrelated publication exports remain usable. Migration 028 and updated migration contracts pass. Full loopback-enabled suite completes: 342 tests, 339 passed, zero failed, three external PostgreSQL skips (78.79 sec). Strict TypeScript/Vite build passes. No existing worker deletion request was submitted; main local dev has not been restarted for these backend edits. Overall estimate approximately 57%; accepted answers/help/import/pseudonymization/final completion and production gates remain unfinished.
- Deletion job fence: acceptance atomically cancels non-staging recording leases, clears recording transcripts and blocks unfinished PostgreSQL assessment jobs. Callback-injected deletion tests prove late transcription/assessment cannot persist or retry; SQLite also rechecks provided staff session tokens. Sixteen focused deletion/retention/import/recording checks pass. Full relational redaction and completed deletion remain unimplemented; no existing local data was altered. Estimate remains approximately 57%.
- Deletion follow-up verification: strict TypeScript/Vite build passes. With loopback permission, the affected PostgreSQL domain/runtime/migration and isolated backup/restore run completes with 53 passed, zero failures. Latest 12 deletion/retention/import checks pass. The earlier 334-pass full suite predates migration 027 and is historical evidence, not a full-suite claim for this foundation. Main local dev API has not been restarted for these repository-only changes; no public deletion endpoint exists.
- Worker deletion foundation: scoped confirmed repository acceptance, immutable fingerprint receipts, atomic access revocation/audit, permanent reactivation fence and age-independent retryable audio cleanup are implemented for SQLite/PostgreSQL. Migration 027 and synthetic cutover preserve deletion receipts. Focused deletion/retention/import checks pass 12 tests; migration/embedded checks previously pass 14. No HTTP/UI or overall completion claim: transcript/help/export/import/job cleanup and pseudonymization remain outstanding. No existing worker was deleted. Estimate approximately 57%.
- Full-suite verification after cutover test: `node --test` with local HTTP loopback permission completed in 77.80 seconds: 337 tests, 334 passed, zero failed, three external PostgreSQL skips. The first permission-enabled run exposed one obsolete forged staff-scope assertion; corrected it to expect Forbidden without weakening repository authorization. Production readiness is still unproven; real PostgreSQL concurrency, full deletion and other feature/deployment gates remain outstanding.
- Retention cutover verification: all five PostgreSQL import tests pass. The added disposable synthetic test proves policy/receipt preservation, completed and interrupted purge tombstones, exclusion of both audio objects from backup, cleared imported leases, and successful resumed cleanup. No existing local data or policy was changed. Estimate remains approximately 57%; full worker deletion remains unimplemented.
- Final retention follow-up: five retention repository checks plus reload-recovery validation and HTTP contracts pass in a 14-test subset. The broader PostgreSQL domain/retention run passed 44 tests; four affected PostgreSQL playback checks pass after final account revalidation. Private playback rechecks cleanup and active account/session authority after storage reads. Scoped tab-local policy recovery verifies exact immutable receipts before clearing and never resends on reload. Strict build passes with a 5.75 kB retention chunk. Main dev service intentionally restarted to load API edits as session 16614, live on 3020/3021; browser reload shows unconfigured policy, Save disabled until confirmation, and enabled after checking then unchecked without saving. No existing policy/audio was changed. Estimated planned completion remains 57%.
- Audio retention checkpoint: SQLite/PostgreSQL policy APIs, explicit client confirmation, revisioned receipts, migration 026, durable cleanup leases/backoff, playback and recording-worker fencing, storage removal/audit, native restore and synthetic import preservation are implemented. Three retention tests, two backup/restore tests, and a 22-test corrected migration/API/runtime subset pass; strict build passes (main 497.82 kB / 133.30 kB gzip). Broad suite found three stale migration expectations, repaired and checked in the subset; a fresh all-green full suite is not claimed. Desktop render and disabled Save are observed; 375px geometry fits, full mobile capture remains unverified. Approximately 57% of planned build, not production readiness. See docs/RETENTION.md.
- Continuation verification: assignment denominators now use actual published audience size; blank language artifacts fail presence checks; SQLite readiness/usage revalidate active staff and allow administrators consistently with PostgreSQL. Usage client cancels obsolete requests and exposes refresh failures. Focused model/HTTP checks and strict build pass. Prior full-suite process handle 76551 is unavailable after session transition, so its completion is not claimed. Reticle has no connected browser session; no new visual verdict is claimed. Whole-build estimate remains approximately 56%.
- Project root: D:\understod (one o after st); D:\understood is out of scope.
- Specification: UNDERSTOOD_SPEC.md, 44 selected screens and A01-A18.
- Git: project root is not a Git repository; no branch/commit.
- Milestone: M2 remains in progress, with selected M3/M6 slices implemented. Not production-ready and not complete 44-screen coverage.
- Active checkpoint: durable preparation stage progress/error evidence, scoped language-readiness evidence and a truthful plan/usage read model are implemented for site staff. Migration 025, safe stage/error DTOs, retry history, UI/content/provider separation, synthetic-only checks, measured response units and explicit unknown-cost states are covered. Full suite `node --test` is terminal: 327 tests, 324 pass, zero fail, three external PostgreSQL skips (80.87 sec). Strict build passes after code-splitting: main 497.42 kB/133.23 kB gzip plus readiness/usage chunks. Whole-build estimate approximately 56%, not readiness.
- Service reconciliation: prior dev handle 40872 is unavailable; read-only external health checks confirmed 3020/3021 ECONNREFUSED. Main synthetic/email-disabled dev restarted as 3089 on 3020/3021. Restricted fixture 44371 was confirmed live but sockets were inaccessible (EACCES/read-only external timeout), explicitly stopped, then disposable permission-enabled fixture 41020 ran and was explicitly stopped after browser QA. No restart solely on an observation timeout. Browser viewport reset and QA tab closed. Saved evidence hashes/integrity/FKs match; no provider, real-data, cloud or paid resource operation.
- Root integrated and tested export/import/backup, synthetic PostgreSQL cutover/report parity and activity history. Existing foundation agents finished earlier; later CSV/backup followups hit usage limits without implementation. No independent review of those new files is claimed.

## Decisions

- Gemini free tier is synthetic-only. Real worker audio/responses must not be sent on that tier. No live AI call, email, account connection, billable request, real onboarding or deployment occurred.
- Chosen but not provisioned: Render web + worker, Neon Free PostgreSQL (no automatic paid upgrade), private Cloudflare R2. Database quotas, wake latency, TLS/concurrency and independent restore remain rollout gates. See docs/DEPLOYMENT_TARGET.md.
- Main app still uses local SQLite/private files. PostgreSQL and R2 foundations are not a completed cloud application.

## Implemented and checked

Current client checkpoint: confirmed English audio-only and Arabic/Urdu translation/
audio controls require server-verified generated baselines. Competing detail edits,
copy/archive, version/language selection and target review are guarded; published
versions/auditors have no command. Exact tab-local pending requests survive uncertain
responses and reload, verify private receipts before clearing, and retry only original
IDs. Failed target jobs link to the existing same-job retry. Lazy briefing views have
load-failure/reload states. Browser discovered and verified a Cancel/Escape focus repair.
Disposable browser checks cover Arabic success/lost-response reload/explicit receipt,
Urdu failure/retry-to-ready and 320px RTL geometry, retained next-draft baseline without
ready audio, English audio-only and immutable/auditor absence. Three screenshots are in
docs/TARGET_REGENERATION.md. Full suite command: permission-enabled node --test
tests/*.test.mjs, session 50488 terminal 325/322/0/3. Build: node
'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' run build, exit zero.
Focused DTO/retry 2/2 passes after correcting a test's wrong job-state expectation
('completed' to the existing 'ready' enum); recovery checks 2/2 pass in full suite.
Ten saved hashes/integrity/FKs match both before and after dev restart; permission-
enabled read-only health returns web/API 200, synthetic-demo. The requested actual
30-second pause completed, followed by resumed stage-progress source inspection.
Durable preparation progress now records validated starts/completions/reuse/failures,
stores retry attempts without exposing lease/provider data, and renders current plus
previous attempts in processing detail. The new regression proves a failed provider
attempt, a later retry, and atomic storage/finalization completion. Migration 025 runs
in embedded PostgreSQL and synthetic import lists it as target-only. No Reticle,
all-reference, full accessibility, actual speech quality, external concurrency or
production claim.
The backend and earlier checkpoint records below are historical.

Final targeted-regeneration backend verification: session 18028 completed with
323 tests/320 pass/zero fail/three external PostgreSQL skips (69.47 sec). Earlier
18975 completed 322/319/0/3 before the final failed-job retry and stricter foreign
baseline checks. Focused selected-regeneration retry checks pass 2/2; focused
backend/HTTP session 72459 passes 5/5 and bundle/migration checks pass 15/15.
Final strict build passes without a chunk warning: main 490.87 kB/131.88 kB gzip,
language chunk 10.50 kB. All needed test/build sessions are terminal. Main dev
40872 confirmed live; permission-enabled read-only web/API health checks are 200,
synthetic-demo. Ten saved row hashes match; SQLite integrity OK/FKs zero. No persisted
schema migration, fixture restart or new browser mutation. Actual 30-second pause
completed, then source/syntax inspection resumed. No new browser/Reticle claim.

- Targeted regeneration backend: migration 024 binds immutable scoped requests to exact baseline bundle/revision, new job and requester role/session. Confirmed owner/supervisor API and private GET receipts enforce exact replay, changed-payload conflict, authority/origin/input/query checks and atomic audit/revision/queue changes. The worker verifies real private bytes and full compatible source/review/glossary/language/provider dependencies before selected calls. Audio regeneration preserves all text; translation regeneration resets only that override and checks the selected translation before speech. Other language text/audio stays byte-exact without new provider calls; reused bytes get new immutable storage identities, not storage deduplication. Failed jobs retry the same intent; corrupt/missing/incompatible/revoked/stale cases fail honestly. Published snapshots/audio remain unchanged. Screen commands/tab-local recovery are next, not implemented or browser-verified. Overall estimate remains approximately 49%, not readiness. No live provider, paid DB, cloud/account/spending/deployment or real worker data. See docs/TARGET_REGENERATION.md.

- Optional translated draft-edit checkpoint: bounded Arabic/Urdu full target edits extend the existing scoped revision/immutable-review-receipt transaction; exact replay, lost acceptance, old-worker invalidation and SQLite/PostgreSQL/import preservation pass. Fixed-order normalization keeps legacy reviews/hashes unchanged. Generated preparation always checks edited source/terminology before exact-text speech and rejects missing capabilities, stale claims and failed checks; current draft audio is invalidated, published audio/snapshots unchanged. Canonical demo refuses unsupported target edits. Optional language-view editor preserves source/other-target overrides, disables competing views, supports automatic reset/failed repair, locks uncertainty and reload-recovers exact accepted receipts. Browser disposable checks Arabic save/failure/repair, lost acknowledgement/reload, Urdu preservation/320px RTL, Cancel and immutable/auditor absence pass. Full suite 86978: 314/311 pass/zero fail/three external PostgreSQL skips (62.6 sec); final rerun recorded below. Strict build passes (main 490.87 kB/131.88 kB gzip; language chunk 10.50 kB), on-demand view with no warning-threshold change. Ten saved hashes/integrity/FKs match, original dev 40872 live; permission-enabled web/API health 200 after restricted socket EACCES, no restart. Estimate approximately 49%, not production readiness. Selective translation/audio regeneration and all live/security/privacy/operations/reference/a11y/deployment gates remain open. Neon Free only; no paid DB, provider call, real data, account connection or deployment. See docs/TRANSLATION_EDITS.md.

- Staff generated-audio playback checkpoint: isolated PostgreSQL briefing DTOs expose owner/supervisor-only journal-backed same-origin URLs for current ready drafts or exact immutable publication history. Scoped body/question routes verify private WAV and recheck source/revision/review/glossary, role/session and selected snapshot after slow object reads. Worker/auditor/foreign/stale/query override/corruption denials pass. Client URL identity checks, native controls, mutual exclusion, change/unmount cleanup and truthful error/reload have browser evidence. Twenty-one generated tests plus three language-model checks pass. Full final session 50001: 307 tests/304 pass/zero fail/three external PostgreSQL skips (67.1 sec); earlier 43197 also passes. Strict final TS/Vite build passes (main 498.25 kB/133.91 kB gzip). Disposable owner/auditor browser checks ready/published/unready version selection, 320px Urdu RTL/native playback, 1440px English playback/geometry and storage failure/reload. Tone fixtures prove delivery, not actual speech quality or reference/a11y completion. Initial restricted-socket fixture was explicitly stopped after health/listener diagnosis, then permission-enabled fixture 17795 ran and stopped; no restart based solely on timeout. QA tab closed, viewport reset, main dev 40872 remains live with web/API 200. Ten saved hashes/integrity/FKs unchanged. Overall estimate stays approximately 48%, not readiness; S11/S13/S18 and all remaining gates stay partial. Neon Free only, no paid upgrade/provisioning/deployment or real content/provider call. See docs/LANGUAGE_ARTIFACTS.md.

- Generated-audio pipeline checkpoint: isolated PostgreSQL preparation worker/scheduler can use an explicitly injected synthetic adapter to generate, stage and atomically attach manifests/audio while committing ready draft/job/audit. Rechecks fence stale revisions/dependencies/leases; audit failure rolls back and lost acceptance reconciles without destructive compensation. Publication verifies exact private bytes outside long locks, then rechecks frozen journal/snapshot/source/review/glossary/current audience/languages. Accepted request replay works during storage outages. Assignment-derived private briefing/question HTTP playback rechecks worker/grant/session after storage reads, retains frozen language and excludes rubric/metadata. Worker native controls provide seek/play/pause, mutual exclusion, localized error/reload and no device fallback. Seventeen focused tests pass; full final session 39343: 302/299 pass/zero fail/three external PostgreSQL skips (65.4 sec), earlier 4963 also passes. Strict TS/Vite final build passes (main 496.65 kB/133.41 kB gzip). In-memory browser checks 320px EN/AR/UR and 1440px Urdu geometry/tone playback/errors/reload pass; this is not real speech/language/a11y certification. Ten saved hashes/integrity/FKs unchanged; dev 40872 live and web/API 200. Temporary fixtures/tabs stopped/closed; actual 30-second pause followed by resumed verification. Approximate overall completion 48%, not production readiness. No live AI/paid DB/provisioning/deployment; default SQLite demo and startup refusal unchanged. See docs/GENERATED_AUDIO.md.

- Durable generated-audio checkpoint: migration 023 adds immutable scoped bundle/audio write-intents with composite job/site references, exact manifest/text/byte metadata, accepted storage evidence and legal storage/cleanup states. Internal staging checks current source/review/glossary/revision/lease, persists intent before files, verifies readback, reconciles unknown object/commit acknowledgements and replays exactly without deleting accepted audio. Leased orphan cleanup excludes attached or active-owner bundles and is scheduled in the isolated rehearsal. Import locks/requires empty journal targets. Canonical dependency/manifest hashes survive jsonb key ordering. Nine focused generated tests include actual temporary private files, forged-scope DB denies, corruption, audit rollback, changed drafts, lost acknowledgements and stale cleanup. Final full rerun 294/291 pass/zero fail/three external skips; strict build passes. Ten saved hashes/integrity/FKs and dev 40872 health unchanged. No production worker/publication/playback, R2/Neon, linguistic or process-kill gate is claimed; approximate completion remains 47%. See docs/GENERATED_AUDIO.md.

- Prepared-language generation boundary: bounded source/review/glossary/provider dependencies, exact asked-fact membership, structured grounding and question checks with at most one regeneration, independently checked title/body/question translation and matching tenant terms, exact-text hashed WAV references and same-language deduplication. Guard checks reject false/throwing authority or revision results before/after every provider operation and after stage callbacks. Gemini speech now validates full canonical audible WAV/base64, explicitly requests 16 kHz WAV and refuses unverified Urdu before calls. Focused 19 pass; final full suite 285 tests/282 pass/zero fail/three external PostgreSQL skips; strict build passes. Initial sandbox HTTP failures were EACCES, corrected by permission-enabled synthetic loopback rerun, not weakened tests. Ten saved hashes/integrity/FKs match; existing dev session 40872 confirmed live and web/API return 200. No runtime/publication/storage integration or live/model/speech-alignment evidence is claimed. Whole-build estimate stays approximately 47%; no screen or readiness gate promoted. See docs/PREPARED_BUNDLES.md. Next: durable scoped artifact staging/reconciliation and revision-fenced worker/publication/playback integration.

- Authentication admission checkpoint: SQLite/PostgreSQL login, recovery and invitation redemption share a persisted 1,000/15-minute ceiling and 2,500-key bound, expired counter cleanup and no counter growth from a blocked varying recipient/token. Successful login preserves IP failures. Shared 1,000-job pending credential-mail capacity rolls back new invitations or password-reset notices atomically, preserves generic public recovery responses and permits exact replay/one-for-one resend. Final full suite rerun 274/271 pass/zero fail/three external PostgreSQL skips; strict build passes. Real two-connection global/key/mixed-mail races are written but unexecuted. Ten saved hashes/integrity/FKs match; email-disabled dev 40872 replaces stopped 8299/73436. Route-wide/tenant abuse policy, permanent metadata retention, spend quotas, live delivery/concurrency and production gates remain open. Approximate completion remains 47%, not readiness. See docs/AUTH_ABUSE_BUDGET.md.

- Invitation client checkpoint: credential-only masked pages/dialogs, exact tab-local receipt recovery and sanitized-fragment signup/existing-account acceptance are implemented. Full suite rerun 262/260 pass/zero fail/two external skips; final strict build passes without chunk warning (main 494.95 kB/133.02 kB gzip). Memory-only browser checks issue/resend accepted acknowledgement loss, unchanged unaccepted retry, cancellation/consent/focus/Escape/paging, 320/1440 geometry, existing acceptance lost acknowledgement/reload/original-link exact replay and explicit Open-site rotation. On-demand screen failure/reload recovers without writes. Signup preview is checked, not browser password entry; full reference/a11y, actual concurrency/delivery, conflicted/closed-tab recovery and production gates remain open. Ten saved hashes/integrity/FKs match after restart to email-disabled dev 73436; saved invitation tables remain absent. Neon Free replaces the paid database target; nothing provisioned. Approximate completion 47%, not readiness. See docs/STAFF_INVITATIONS.md.

- Staff invitation backend now has SQLite/PostgreSQL issue/resend/cancel, private masked paging/receipts, deferred encrypted one-use mail, current issuer/access/account fencing, safe signup or existing-account site linking and authenticated exact retry. Native restore and synthetic cutover preserve accepted evidence but revoke outstanding links and purge ciphertext; scheduler stages are awaited. Full suite 257/255 pass/zero fail/two external skips; strict build passes. Ten saved hashes match after restart, integrity/FKs clean, saved invitation tables absent. Native pre-invitation backup retained; main dev 25770 replaces stopped 39600 with email disabled. Screens/browser/client recovery, actual server concurrency/delivery, wider privacy/security/runtime/deployment remain open. See docs/STAFF_INVITATIONS.md. Completion estimate approximately 46%, not readiness.

- Additive account identities preserve site-local staff IDs/roles and canonical credentials. SQLite/PostgreSQL linked membership, bounded private site list, atomic session rotation with remaining expiry, whole-account password recovery/rotation and disable/restore invalidation are tested. Import preserves membership structure without copying credentials/recovery mail. Native upgrade invalidates older-format recovery state without rewriting saved staff/evidence. Credential-only site picker unmounts old-site views, confirms leaving unsaved edits and resolves uncertain rotation by GET-only session verification; unavailable verification blocks private views. Disposable pre-authenticated browser checks pagination, auditor/administrator role boundaries, injected lost acknowledgement/session read, Escape/focus and 320/1440 layouts. Full suite 236/234 pass/zero fail/two external skips; final strict build passes. Main dev 39600 replaces stopped 7075, email disabled; nine saved hashes/empty credential hash match, integrity/FKs clean, account/recovery tables empty. Real-server concurrency checks are written but unexecuted; invitations and broader production gates remain open. See docs/STAFF_ACCOUNTS.md. Completion estimate approximately 45%, not a measured readiness score.

- PostgreSQL recovery migration 020/repository/anonymous HTTP/awaited worker now match the shared SQLite input and encrypted deferred-mail contracts. Scoped immutable one-use tokens, staff-before-credential/token locks, advisory throttle locks, SKIP LOCKED claims, expiry/lease fences, atomic password/session/notice/audit and lost preparation/reset commit acknowledgements pass embedded tests. Import locks/requires empty recovery targets without migrating local secrets; source unchanged. Full suite 220 tests/218 pass/zero fail/two external skips; strict build pass, separate updated runtime/import checks pass. Real-server parallel claim/reset/rate checks added but not executed. Nine saved hashes match, integrity/FKs clean, recovery tables empty; main dev session 7075 verified live, email disabled. No live mail, worker data, new browser proof, Reticle verdict or production-ready claim. See docs/ACCOUNT_RECOVERY.md. Completion estimate approximately 44%, not a readiness score.

- SQLite credential recovery now has generic deferred/encrypted mail, single-use expiring credential/access-revision-bound links, atomic password/session/token/notice/audit changes and bounded lease-fenced delivery. Restore invalidates recovery state; synthetic PostgreSQL cutover recognizes but does not import local recovery secrets/pending mail. Full suite 213/211 pass/two external skips, strict build pass; earlier memory-only browser queued/disabled/fragment checks recorded. Native pre-schema backup, nine unchanged saved hashes, clean integrity/FKs and empty recovery tables after restart. Dev session 7075 at 3020/3021 with email explicitly disabled; old session 50728 was missing and endpoints confirmed stopped before restart. PostgreSQL recovery/invitations, actual mail/provider/privacy and broader production gates remain open. See docs/ACCOUNT_RECOVERY.md. Completion estimate approximately 43%, not a readiness score.

- Staff access now has owner/admin/auditor scoped paged reads, confirmed role/revoke/restore mutations, site-local last-owner protection, immutable access revisions/receipts and atomic audit/session revocation in SQLite/PostgreSQL. Administrator access is limited to staff management and assigned-site settings; auditor private recording playback is denied consistently. Tab-local GET-only accepted-receipt recovery, migration/import preservation and disposable lifecycle/focus/phone checks pass. Invites, production credential recovery, multi-site grants and conflict/closed-tab recovery remain open. See docs/STAFF_ACCESS.md.

- Gemini dedicated transcription now uses the documented Interactions endpoint, explicit verbatim mode/store:false, validated local WAV preflight, strict completed/model/text response handling and restricted upload destinations/no redirects. Cleanup/failure/redaction mocks pass; adapter remains disconnected with synthetic-only policy. Configured models are documented but Urdu speech/transcription support and account/free-tier entitlement remain unverified. See docs/GEMINI_PROTOCOL.md.

- Glossary now has scoped bounded language-pair/search/status/history reads, confirmed create/override edit/remove/restore/regenerate, immutable versions/receipts/audit and current-draft dependency invalidation. Review values/publications remain unchanged; stale preparation/publication is fenced. Tab-local accepted-receipt GET recovery and explicit original-ID retry, Arabic/Urdu layout and SQLite/embedded PostgreSQL/import checks pass. General live terminology suggestions/application, conflicted/closed-tab recovery and full reference/a11y remain. See docs/GLOSSARY.md.

- Templates have scoped paged search/status, confirmed create/edit/archive/restore/duplicate/use, immutable version/receipt evidence and atomic audit in both repositories/HTTP/import. Use queues a fresh unpublished revision-1 briefing with copied review defaults and no inherited artifacts/audience. Tab-local reload/navigation recovery reconciles accepted receipts without a POST and explicitly retries unaccepted requests with the original ID. Browser lifecycle/history/recovery/phone checks pass. General live preparation and closed-tab recovery remain. See docs/TEMPLATES.md.

- Confirmed question/fact/private-rubric overrides increment draft revision, invalidate preparation and queue regeneration with immutable replay/atomic audit in both repositories/HTTP/import. Tab-local reload/navigation recovery reconciles accepted receipts without a POST or explicitly retries original IDs, including from another briefing destination. Source edits reset overrides; stale preparation cannot overwrite newer edits. Only canonical synthetic-compatible inputs can become ready; general live grounding/alignment remains unavailable. See docs/DRAFT_REVIEW.md.

- Scoped immutable invoice/payment/unpaid-void ledgers support integer USD cents, normalized exact replay, atomic audit, frozen issuer labels and bounded private reads/downloads. Owner mutation/auditor read UI and disposable browser lost-receipt retry/reload recovery, partial balance, overpayment, settlement/download/void pass at phone/desktop widths. Migrations 013/014/importer preserve evidence. Paid/partial correction and closed-tab/cross-device recovery remain open. See docs/MANUAL_BILLING.md.

- PostgreSQL briefing detail now returns independent frozen-audience/latest-response metrics for all returned versions in a repeatable-read snapshot. Isolated different-audience/pending/matched/clarification and role/HTTP checks pass without writes to the saved fixture. Existing 100-version bound and batched-aggregation performance work remain. See docs/POSTGRES_DOMAIN.md.

- Processing queue now has scoped paged status/search/sort, private explicit job details, current-revision retry through existing preparation guards and queued-detail polling. Disposable browser exercised 46 jobs, page/filter/search and failed-to-ready retry/reload at phone/desktop widths. Raw provider errors are redacted. See docs/PROCESSING_QUEUE.md. Real multi-stage AI artifacts/pipeline and operator controls remain open.

- Briefing Languages now compares stored draft or immutable publication source/target text/question with revision/provenance, honest missing/invalid/unverified/device-demo evidence and exact-language device preview. No live audio/regeneration/edit or approval gate. EN/AR/UR inspection and 320/1440 Arabic/Urdu browser checks preserve eight evidence hashes. See docs/LANGUAGE_ARTIFACTS.md.

- Worker directory crew selection now combines current scoped membership (including archived crews/unassigned), language, search, access state and page. Member links and explicit Membership filter are browser-checked without writes; frozen publications/audiences/evidence stay unchanged. See docs/CREW_LIFECYCLE.md.

- Crew lists and membership destination choices now use bounded literal search/status/five-row paging with complete scoped counts in both repositories; directories beyond 500 no longer fail or load unbounded rows. Browser verifies retained selection, cancel/focus, paging and narrow archived/empty states in a disposable fixture. Original hashes unchanged. See docs/CREW_LIFECYCLE.md.

- Credential-mode People now supports bounded private access history, explicit masked one-time fragment links and issue/reissue/revoke confirmation with active scoped staff rechecks. Replacement revokes older links and worker sessions; revoke replay/audit rollback are tested. Disposable browser verified replacement/revocation, not token redemption (browser security blocked URL navigation). See docs/WORKER_ACCESS.md.

- React/Vite/TypeScript staff workflows and EN/AR/UR worker inbox/listen/type/help, two-tenant persisted fixture, scoped sessions/API/DB relationships, frozen publications/audiences and durable synthetic preparation.
- Local credential authentication with scrypt/throttling, hashed HttpOnly sessions, one-use worker grants and revocation. Production mode deliberately refuses startup.
- PostgreSQL authentication repository now implements credential rotation, atomic login/session/audit, persisted failed-login throttling, scoped one-use grants and session/grant revocation. Shared scrypt verification preserves existing local credential compatibility. Isolated credential HTTP tests cover the repository; default HTTP still uses SQLite and real-server concurrency remains unverified. See docs/POSTGRES_AUTH.md.
- PostgreSQL publication/typed/private-audio repositories and assessment workers enforce frozen audiences/languages, revision/deadline checks, request replay, pending receipts, immutable completed assessments, bounded retries and stale-lease fencing. Audio compensation confirms database acceptance before deletion, including lost COMMIT acknowledgments. Draft edits/preparation, explicit private-safe read models and worker/crew repositories now connect through an isolated credential HTTP rehearsal. Twenty-seven focused domain/HTTP tests pass. Default browser remains SQLite; live artifacts, browser contract cutover, cloud recovery/concurrency and schedules/quotas remain gates. See docs/POSTGRES_DOMAIN.md.
- Worker record/preview/rerecord/upload UI; actual mono PCM WAV validation and private storage before receipt. Monotonic receipt ordering, failed-storage compensation, stale transcript/assessment fencing and bounded processor retries tested. Live recording processor is not scheduled in synthetic mode; physical microphone not verified.
- Server-only Gemini and optional OpenAI adapters have mocked preparation/translation/speech/transcription/assessment tests. Free-tier real-data guard exists. No live call or real-model accuracy evidence.
- Twenty-four PostgreSQL migrations cover scope, receipts, frozen publications/audience/language, crews/imports/exports, audit guards, assessment/preparation leases, immutable help/resolution evidence, exact-version withdrawal, directory reactivation, draft copy/archive, billing/unpaid void, organization/site settings, draft review, templates, glossary, staff access, encrypted recovery, linked accounts, invitations, generated-audio journals/cleanup and targeted-regeneration requests. Synthetic-backup importer defaults to rollback, refuses nonempty targets, preserves evidence order, omits credentials/revokes imported access and commits/replays explicitly. All execute in embedded PostgreSQL 18; external pg wire/TLS/concurrency skipped. Legacy synthetic language backfill is cutover preference, not real historical proof. See docs/POSTGRES_CUTOVER.md.
- PostgreSQL activity history now implements civil-date filters in site timezone, bounded scoped metadata reads/detail/CSV, formula protection and atomic export audit. Clarifications implement scoped paging/status/owner/overdue/search, original assessment/history reads, ownership and audited immutable resolution; independent help retries are exact/idempotent and do not create answers. Worker status reads exclude private notes/rubrics. HTTP rehearsal paths are tested. Translated follow-up conversation/audio, full escalation/deadlines and default browser cutover remain open.
- Clarification browser now uses the shared SQLite/PostgreSQL paged contract: server-side filters, accessible case buttons, owner controls, original private recording playback where available and immutable audited resolution. SQLite independently retains original help text before notes can change; migration supports retained resolved-help evidence. Four new local checks pass. Existing browser cases were only read/filtered, not resolved; translated worker conversation/history UI remains open. See docs/CLARIFICATIONS.md.
- Shared draft/publication input validation now connects both repositories: stable creation IDs, optimistic revision edits, invalidation of obsolete preparation, explicit active recipient selection, optional UTC deadline, exact durable publication replay and immutable publication requests. Browser draft editor and recipient confirmation are implemented; unsaved editing blocks processing/publication. SQLite voice acceptance rechecks assignment deadline/publication/worker/grant after storage before issuing a receipt. Six additional tests pass. See docs/BRIEFING_PUBLICATION.md.
- PostgreSQL CSV import now reuses the maintained parser and shared validation with durable previews, live conflict revalidation, all-or-none audited confirmation, exact replay, private error CSV and committed expiry purge. No automatic access grants or retroactive assignments. PostgreSQL exports freeze latest receipt metadata at request time, claim/reclaim bounded leases, fence stale workers/revoked requesters, verify exact stored UTF-8 bytes/checksum and purge expired content. Overview/processing reads and latest briefing metrics are wired to the isolated HTTP rehearsal. Expiry worker functions are tested but not yet scheduled by a runnable PostgreSQL service. Embedded transactions do not prove real concurrency/process-kill recovery.
- Local/R2 private storage adapter with scoped keys, bounds, hash validation and redacted failures. R2 tested with injected mock client, not a cloud bucket.
- Workers: site-scoped search/filter/paging/add/edit/disable/confirmed reenable; crews create/list/move, rename, confirmed audited archive/restore plus bounded paging/member filters. Reactivation has immutable scoped receipts and replay fences after later disable/archive; old access stays revoked. Staff access/current site settings are partial; wider staff/site lifecycle remains open. See docs/CREW_LIFECYCLE.md and docs/DIRECTORY_REACTIVATION.md.
- CSV import: strict maintained parser, UTF-8/BOM/quoting/size/row validation, scoped durable preview/errors, replacement, live-conflict revalidation, all-or-none explicit confirmation, replay, no automatic grants or retroactive assignments, 24-hour staged-data expiry. See docs/REPORTS_IMPORTS.md.
- Reports: scoped publication selector, language breakdown, truthful denominator/timezone/latest evidence; durable frozen-snapshot export jobs/history/download/retry/expiry with audit and formula protection. Download is authenticated, not public. No date-range filter.
- Activity history: actual site-scoped staff/auditor read-only events, actor/action/search/civil-date filters, paging/detail navigation and bounded authenticated metadata CSV with formula protection/audited download. SQLite/PostgreSQL audit update/delete guards and PostgreSQL read port tested. No fabricated hashes/roles/events or administrator tamper-proof claim; retention policy and default runtime cutover remain open. See docs/AUDIT_HISTORY.md.
- Local native SQLite backup + private audio isolated restore: integrity/checksum/WAV validation, new directories only, restored sessions/grants revoked, interrupted work reset, source unchanged. Automated isolated test, not an actual production/cloud recovery. Backups are unencrypted/unsigned; Windows ACLs require an operator policy. See docs/LOCAL_BACKUP.md.
- images.rar extracted and 44 selected JPEGs mapped in docs/REFERENCE_MANIFEST.md; three superseded variants excluded. Original selected PNG collection unavailable.

## Latest verification

Current client checkpoint: 50488 completed 325 tests/322 pass/zero fail/three
external PostgreSQL skips (89.86 sec). Strict final build exits zero with main
494.81 kB/132.60 kB gzip, language 11.30 kB and regeneration 5.62 kB chunks, no
chunk warning. Disposable browser verification and screenshots are detailed in
docs/TARGET_REGENERATION.md. Saved ten row hashes are byte-identical, integrity OK,
FK violations zero. Dev 3089 is live; read-only web/API health 200. Temporary
fixture 41020 and full-suite/build processes are terminal. No cloud or live provider.
Next: durable per-stage processing evidence/error contract; source inspection
confirmed prepared-bundle onStage currently emits only starts, not durable stage
completion/results. No stage implementation claim is made yet.

Historical targeted-regeneration backend checkpoint: final 18028 is 323/320 pass/zero
fail/three external PostgreSQL skips; strict final build passes, main 490.87 kB/
131.88 kB gzip. Commands: permission-enabled node --test tests/*.test.mjs;
node --test --test-name-pattern='durable selected regeneration|failed targeted'
tests/generated-audio.test.mjs; node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js'
run build. Initial focused generated run 81030 had 25 pass/two failures: publication
opens draft state with the same checked snapshot (now explicitly supported for
regeneration, not ready playback), and a fixture referenced a nonexistent glossary
table (corrected to actual scoped term/version rows). Corrected focused tests and
both full regression runs pass without weakening assertions. Current evidence and
remaining scope are at the top of this file and docs/TARGET_REGENERATION.md.
Totals and next-action statements below are historical unless labelled current.

### Historical verification

Current 2026-10-06 generated-audio pipeline checkpoint supersedes historical totals below: 302 tests, 299 pass, zero fail, three external PostgreSQL skips; strict build passes. Commands: node --test tests/generated-audio.test.mjs (17 pass, session 19951); permission-enabled node --test tests/*.test.mjs (final session 39343 completed, 65.4 seconds; earlier 4963 also passes); node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' run build (final build exit zero, main 496.65 kB/133.41 kB gzip). An initial HTTP test used the wrong credential return shape; corrected the fixture without weakening assertions. Post-read session revocation test first failed until its intended guard was applied, then passed. Browser memory fixture 76575 stopped before restart 50028, which was stopped after final failure/reload checks; no live service was restarted on an observation timeout. Ten saved hashes match, integrity OK/FKs zero. Dev 40872 remains live, web/API 200 synthetic-demo. Actual 30-second pause followed by verification. See docs/GENERATED_AUDIO.md.

Staff access checkpoint (2026-10-05): 203 tests/201 pass/zero fail/two external PostgreSQL skips; final strict build passes. Fifty focused staff/recovery/domain checks pass after correcting PostgreSQL auditor audio permissions and authorization-before-storage ordering. Disposable browser accepted role change survives lost acknowledgement/reload with GET only; revoke/restore, last-owner denial, filters, paging, Cancel/Close focus and 320/390/768/1440 overflow checks pass. Saved schema native backup created; integrity/FKs and nine original evidence hashes match; new saved access ledgers empty. Native backup also matches the preserved staff credentials and nine evidence tables. Dev 50728 replaces stopped 97854; disposable fixture 10800 stopped. Main tab 8 retained for continuation, no saved sign-in/mutation performed. See docs/STAFF_ACCESS.md. Completion estimate approximately 42%, not a measured readiness score. No required screen or production gate is declared complete. Continue invites/recovery/multi-site grants, full AI artifacts and remaining production gates.

Gemini protocol follow-up (2026-10-05): final full suite 193 tests/191 pass/zero fail/two external PostgreSQL skips; strict build passes. Current official docs checked; transcription request/response mismatch corrected, unsafe uploads and corrupt/silent WAV rejected before generation, cleanup attempted after provider/parsing failure without masking the original failure. Ten focused Gemini/audio tests pass. No live provider call or default-fixture mutation. Production and live language gates remain open. Completion estimate remains approximately 41%; next independent work includes staff lifecycle/last-owner protection, recovery conflicts and complete prepared-language artifacts.

Glossary checkpoint (2026-10-05): 190 tests/188 pass/two external skips; strict final build passes. Disposable browser verified accepted edit reload GET recovery, unaccepted create original-ID retry, remove/restore/regenerate/history and 320/1440 Arabic/Urdu layout. Unsupported live regeneration fails honestly, with no new version/receipt. Eight original evidence hashes match; saved glossary/review/template ledgers empty, shelf ready revision 1 and v3 totals unchanged. Fixture 83802 stopped; dev 97854 replaces stopped 5142. See docs/GLOSSARY.md. Completion estimate approximately 41%, not production readiness; no required screen or external gate is declared complete. Continue unresolved recovery conflicts, live artifacts, administration and remaining gates.

Draft-review recovery checkpoint (2026-10-05): 183 tests/181 pass/two external skips; strict build passes. Disposable browser reconciled accepted review at revision 2 with GET only, then resolved unaccepted review by explicit original-ID retry from another briefing destination at revision 3; recovery cleared on reload and heading focus returned. Malformed success acknowledgements cannot clear review/template pending records. Phone/desktop checks pass; all original hashes match and saved new ledgers empty. Dev 5142 replaces stopped 91422; fixture 56366 stopped. See docs/DRAFT_REVIEW.md. Completion estimate approximately 40%, not a production-readiness claim. Production incomplete; continue glossary and remaining gates.

Draft review checkpoint (2026-10-05): 178 tests/176 pass/two external skips; final strict build pass. Revisioned overrides, regeneration, exact replay/atomic audit, old-worker fencing and import tested in both repositories. Disposable browser recovered one interrupted accepted save, failed an unsupported question honestly, repaired with automatic defaults and checked consent/cancel/reload/320/1440. Original hashes match; review ledgers empty and saved draft revision 1 unchanged. Sixteen migrations execute in embedded PostgreSQL. Dev 58346 replaces stopped 85566; fixture 24945 stopped. See docs/DRAFT_REVIEW.md. Templates next; production remains incomplete.

Settings checkpoint (2026-10-05): 174 tests/172 pass/two external skips; final strict build pass. Scoped owner name/contact/timezone edits preserve revisions, immutable replay/atomic audit, frozen invoice labels and settings in backup import. Disposable browser lost-response retry, header refresh and 320/1440 cancel/reload pass. Original business/audit hashes match; billing/settings ledgers empty. Fifteen migrations execute in embedded PostgreSQL. Dev 85566 replaces stopped 71319; fixture 72156 stopped. See docs/WORKSPACE_SETTINGS.md. Site/staff lifecycle, wider recovery and production gates remain open.

Archive checkpoint (2026-10-05): both repositories/HTTP/import implement confirmed revision-and-publication-generation-checked archive, immutable receipt/atomic audit, preparation cancellation and lost-COMMIT replay. Published content/audience/accepted responses/clarifications remain readable; pending assessment finishes; new edits/preparation/publication/worker submissions close. Active/archived/all library filtering and archived-source copying work. Full suite 156/154 pass/two external skips, final strict build pass. Browser saved-dialog cancellation/keyboard/320/1440 checks and disposable actual archive/reload/filter/Arabic worker history pass. All eight current saved hashes match; archive ledger empty, v3 still published. Dev 71264 replaces 80335; disposable 16417/35258 stopped. See docs/BRIEFING_ARCHIVE.md. Production gates remain open.

Copy checkpoint (2026-10-05): confirmed current-source revision copy into separate unpublished v1 with no inherited artifacts/readiness/audience. Immutable receipt/atomic audit/post-edit/lost-COMMIT replay tested in both repositories/HTTP/import. Full suite 151/149 pass/two external skips, final strict build pass. Browser dialog guards/reset/focus at 320/1440 and actual memory-only copy/missing-artifacts/destination focus checked; fixture stopped. Seven saved hashes match, audit gained one expected export expiry (16 rows), copy ledger empty. Dev 80335 replaces 36428. See docs/BRIEFING_COPY.md. Archive next; production incomplete.

Reactivation checkpoint: both repositories/HTTP routes implement confirmed stale-label-checked worker reenable and crew restore with immutable exact replay receipts. Old links/sessions and frozen evidence remain unchanged; lost COMMIT acknowledgment, audit/receipt rollback and later-disable/archive retries tested. Full suite 148/146 pass/two external skips, strict build pass. Browser confirmation/cancel/reset/focus and 320/1440 checks made no reactivation writes. Eight saved hashes match; ledger empty. Dev 36428 replaces stopped 55632; memory rehearsal 43372 stopped. See docs/DIRECTORY_REACTIVATION.md.

Language artifact checkpoint: read-only coverage/comparison and revision/provenance for draft v4 and frozen v3, honest device-only audio and exact-language voice availability. Full suite 146/144 pass/two external skips; final empty-source focused checks and build pass. Arabic/Urdu 320/1440 layout and Arabic device preview/cancellation checked; Urdu voice unavailable. Eight persistent hashes unchanged. S11/S18 remain partial, with no live audio or regeneration/edit controls. Dev session 55632 remains running.

Crew checkpoint: both repositories and HTTP routes implement scoped stale-name-checked rename and explicitly confirmed archive. Archive rejects new membership moves but retains existing members/access/evidence. Audit failure rolls back; PostgreSQL lost-COMMIT acknowledgement replays once. Full suite 137/135 pass/two external skips; final focused lost-commit tests and build pass. Browser rename/Cancel, archive confirmation reset/Escape, focus wrap/return and 320/1440 widths checked without mutating the existing crew. Six evidence hashes unchanged. Dev session 24277 replaces stopped 58820. S27 remains partial; next worker access-link controls.

Worker inbox checkpoint: both list contracts are paged objects with server-side todo/sent/history filtering and complete scoped counts. Sent includes accepted closed versions; expired unanswered versions do not appear in todo. Private-safe DTO and active/grant authority are retained. Both isolated fixtures cross 126 versions/page 7; Arabic and Urdu browser states, refresh/detail/back and 320/1440 layouts checked. Urdu wrapping fixed; no evidence hashes changed. Full suite 134 tests/132 pass/two external PostgreSQL skips; final build pass. Dev session 58820 replaces stopped 49493. The persistent fixture has one assigned version per worker, so forward paging is isolated-test evidence.

Directory checkpoint: both APIs page exact frozen worker assignments under active scoped owner/supervisor authority. People opens receipt history and actual case links; disabled worker history remains read-only without restored access. Tests verify closed versions, paging, private-safe metadata and authority. Browser verified preserved Worker 014 history, unassigned empty state, refresh/focus return and exact case link at 320/1440 without document overflow. Full suite 132/130 pass/two external skips, final build pass; evidence hashes unchanged. Dev session 49493 replaces stopped 28070. Next: worker assigned-version pagination beyond the old 100-item ceiling.

Staff checkpoint: both session read models expose the scoped site timezone; staff profile and creation/directory affordances follow the actual role. The date/greeting use the site clock, not the reference's fixed Friday. SQLite directory operations now recheck active staff identity, role and organization/site, matching PostgreSQL authority. Isolated fixtures explicitly grant their foreign-site test owner instead of forging a session scope. Full suite: 132 tests, 130 pass, two external PostgreSQL skips; focused final clock tests and build pass. Owner browser shows Sunday 4 October 2026 / Good evening, Maya / owner with unchanged evidence hashes. No auditor browser persona or live PostgreSQL proof claimed. Dev session 28070 replaces stopped 62677.

Worker-submission checkpoint: both APIs whitelist only the worker's own accepted receipt/text/transcript/outcome/private recording reference with paged latest-first history, rechecked active principal/grant authority and retained closed publications. EN/AR/UR UI, Arabic browser refresh/narrow/wide checks and privacy/denial/replay-history tests pass. Evidence hashes unchanged; sessions changed by demo sign-out/profile selection only. Dev 62677 replaces stopped 28825. See docs/WORKER_HISTORY.md. Next: remaining directory response links, lifecycle/staff workflows and production gates.

Response checkpoint: both APIs implement exact-publication recipient metadata and receipt-ordered paged submission history, including pending/failed audio and existing cases. Staff scope/authority/invalid-filter/read-only preservation tests pass. Browser filters/two pages/empty/history/focus and 320/1440 checks pass; preserved hashes unchanged. Worker 030's earlier nonempty Urdu text/empty_answer historical inconsistency is documented, not rewritten. Dev 28825 replaces stopped 73959. See docs/PUBLICATION_RESPONSES.md.

Library checkpoint: both APIs share paged search/draft-state/latest-publication/sort contract with one-statement counts and rows, bounded inputs and private-safe results. Isolated tests cross 125 matches; browser combined-filter/empty/sort/mobile-wrap checks pass. No persistent evidence changed; hashes remain identical. Dev 73959 replaces stopped 82737. See docs/BRIEFING_LIBRARY.md.

Withdrawal checkpoint: both repositories/HTTP contracts implement authorized exact-version withdrawal, immutable reason/time, atomic audit and durable replay including lost commit acknowledgement. Pending accepted assessment can complete, new answer/help closes, worker history/reports stay readable. Ninth migration and importer preserve this evidence. Browser confirmation-reset/Escape/mobile checks did not withdraw v3; all original hashes match and ledger is empty. Dev session 82737 replaces stopped 99357. See docs/PUBLICATION_WITHDRAWAL.md. Next: library paging/lifecycle filters; broader production gates remain.

Language checkpoint supersedes the earlier SQLite gap: new assignments capture publication language; SQLite triggers freeze it and require matching snapshot content. Worker/report/case/recording reads use that frozen value, and PostgreSQL import preserves it. Legacy synthetic backfill is current-preference evidence only, explicitly not historical proof. Native pre-upgrade backup plus identical evidence hashes verify preservation of the running fixture. Dev session 99357 replaces stopped session 29280. Browser report remains 30/25/22/3/5, with frozen EN/AR/UR 12/10/8. See docs/ASSIGNMENT_LANGUAGE.md. Next: remaining publication lifecycle controls and broader staff/site/security workflows.

Worker checkpoint: shared pending receipt state and explicit worker-safe content DTO; sent-answer/history tabs; own assigned closed versions remain readable; help-request/follow-up status history excludes private notes/rubrics. New UI state checks plus both HTTP repositories pass. Arabic browser read/refresh/reload and 320/1440 layout checks preserve v3 metrics. No new publication/answer/help/resolution. See docs/WORKER_HISTORY.md. Dev restarted into session 29280; sessions 57022 and 67345 stopped. Next: SQLite frozen assignment-language parity and remaining lifecycle controls.

Runtime checkpoint supersedes earlier runtime gaps: standalone synthetic-only PostgreSQL check/API/worker and scoped credential rotation commands now exist. Read-only startup verifies the complete checksum ledger, refuses unsafe configuration and never seeds/applies DDL. Awaited worker stages include preparation, typed assessment, exports and import/export/staged-audio expiry. Rehearsal cookies are isolated from SQLite; Vite supports separate ports. Shared deadlines reject calendar rollover and missing time zones. Prepared GitHub CI includes disposable real PostgreSQL concurrency tests but has not run in this non-Git workspace. No external PostgreSQL service, cloud account or deployment has been started. See docs/POSTGRES_RUNTIME.md. Continue worker pending/help/history UI next.

| Environment / check | Result |
| --- | --- |
| 2026-10-05, Node 24.5.0: node --test tests/*.test.mjs | 193 tests: 191 pass, 0 fail, 2 external PostgreSQL skips. Gemini protocol/WAV/cleanup, glossary/dependency/import/recovery and prior coverage pass; strict frontend build passes. Real wire/concurrency tests remain unexecuted locally. |
| Direct npm CLI run build | Strict TypeScript and optimized Vite build pass after final UI edits. npm shell shim is broken; use Node with the installed npm CLI. |
| node scripts/evaluate-synthetic.mjs | 19/19 narrow synthetic cases; no false match in this set, not a real-model evaluation. |
| Dependency installation audit | 114 packages, zero vulnerabilities reported at latest Node type installation; not a security certification. |
| In-app browser, synthetic loopback | Workers/crew/disable, CSV preview/confirm/refresh receipt, report export/download, plus activity date/action filters/detail/download/resulting saved audit event exercised. |
| 320/390/768/1440 CSS px | People/Reports/Import and Activity checked; shared narrow-header overflow corrected. Activity document widths 305/375/753/1425, no document overflow. Internal wide table scrolling remains. |
| API /api/health | ok / synthetic-demo after service restart. Reticle not connected; no Reticle verdict. |

## Running service and preserved state

- Dev command: node scripts/dev.mjs with UNDERSTOOD_EMAIL_MODE=disabled, exec session 40872. Web http://127.0.0.1:3020/, API 127.0.0.1:3021. Restarted after final authentication admission hardening. Default app remains SQLite; PostgreSQL changes run only in isolated tests. Sessions 8299/73436 and earlier services are stopped. Disposable invitation browser fixtures and test processes are stopped. Reticle is unavailable; no verdict is claimed.
- Preserve data/understood.sqlite and data/private-audio. Canonical in-memory fixture is 30/24/21/3/6 = 80%. Browser submissions changed persistent published v3 to 30 assigned, 25 responses, 22 matches, 3 clarifications, 5 pending = 83%; do not reset to make screenshots match.
- Synthetic Browser QA 900 was added, moved into Browser QA Crew, then disabled. CSV explicitly added Browser Import 901 (Arabic, same crew) and Browser Import 902 (Urdu). Directory now has 32 active workers; frozen v3 audience remains 30. No grants were issued to these entries.
- Successful import receipt: b522dc83-55d4-43c5-a870-9659fe9abed4. Export: 6e23b7ea-44ec-448f-8deb-9c8576f64dd1 (24-hour expiry); downloaded CSV in the user's Downloads.
- Screenshots: docs/evidence/worker-import-2026-10-04.jpg and activity-history-2026-10-04.jpg. Activity download: C:/Users/Fares/Downloads/activity-history.csv; audit event 5117a63d-02e6-4311-a2cf-676c04bda833. More observations/limits in docs/evidence/browser-check.md.
- Post-restart browser check: report remains 30/25/22/3/5 = 83%. Four actual open cases shown; unassigned filter returns one. Draft edit/cancel and unsaved-edit guard verified. Existing v4 was prepared synthetically, with resulting preparation audit events; no v4 publication, new answer/import/export or change to v3. Recipient filter/selection/confirmation/deadline tested without submission. Screenshots include docs/evidence/draft-revision-controls-2026-10-04.jpg and publication-recipient-confirmation-2026-10-04.jpg. Browser tab 2 is #briefings/shelf. This checks default SQLite, not PostgreSQL browser cutover. Reticle remains unconnected.
- No physical microphone, real recording, offline outbox, external PostgreSQL, R2, email, provider or deployed environment verified.

## Open scope / next task

Current next work: expose the implemented selective translation/audio regeneration API/worker with exact tab-local receipt recovery, competing-edit guards and honest supported-baseline controls; then disposable Arabic/Urdu/English, failed retry, lost-ack/reload, immutable-version, narrow-layout and keyboard checks. Ordinary optional edits still rebuild the whole bundle. Structured per-stage progress, speech alignment/evaluation, enabled language/tenant fences and quota/cost reservations remain before main live runtime. Targeted jobs now fence requester role/session, not all existing job types. Generated DB/object restore/process-kill/real concurrency, schedules/reminders, retention/deletion, offline/shared-device and operator incidents remain open. Invitation/multi-site/conflict/closed-tab/external-delivery gates remain. Execute pg races when an authorized server is available. Neon Free only; no paid database or automatic upgrade. Email disabled, real worker data off Gemini free tier. Complete original scope without resetting saved evidence.

Manual billing/void checkpoint: full suite 171/169 pass/two external skips; strict build passes. Confirmed unpaid void stores separate immutable evidence, preserves original totals, cancels balance and blocks later payments. Tab-local owner/site-scoped invoice/payment/void requests reconcile accepted receipts on reload without writes; unaccepted ones offer explicit original-ID retry. Both void paths and narrow dialog/consent/focus/status were checked in disposable browser. Seven saved business hashes/audit match, invoice/payment/void tables empty. Fixtures stopped; dev 71319 replaces stopped 58359. Next: organization/site settings and remaining M2/M3/external readiness gates; paid/partial corrections remain tracked. No real payment/provider/cloud/deployment action; checkpoints are not production completion.

1. Complete isolated runnable PostgreSQL cutover before changing the default app. Shared draft/publication and clarification contracts are wired; other scoped HTTP ports are tested. Library/inbox/receipt-history pagination and per-returned-version metrics are implemented; historical-version paging/performance remain open. Current credential HTTP rehearsal is not a deployed or full browser application. Real PostgreSQL test setup question remains unanswered; continue independent work meanwhile. Preserve local fixture and do not enable production prematurely.
2. Complete public/account/onboarding and staff/site administration with real invitation/recovery state and honest unavailable delivery until configured. Continue templates/glossary, usage/manual invoices, operator pages, audit retention, deadlines/audience/schedules and translated clarification inbox.
3. Implement full retention/deletion, offline/PWA outbox/shared-device isolation, quotas/cost reconciliation, incident controls and actual worker termination/concurrency drills. Add CI/fresh-production-setup and deploy/rollback checks.
4. Complete all 44-reference control/visual and accessibility coverage, all-language errors and physical device testing. Obtain a privacy-approved provider path before any real worker data; authorized synthetic live evaluation/cloud setup remain external gates.

Read docs/BUILD_PLAN.md, docs/FEATURE_REGISTER.md, docs/DECISIONS.md and docs/READINESS.md on resume. Complete independent work without cloud credentials; do not relabel the app production-ready.
