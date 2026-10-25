# Understood — complete implementation prompt for the simplified SaaS

Prepared: 23 October 2026. Status: implementation instructions for a future execution, not a record of completed application changes.

## 1. Assignment and priority

Upgrade the existing Understood application into the simpler product specified below. Work in the actual supplied application checkout; locate it before changing anything. The reviewed checkout was `C:/Users/Hussein/Desktop/Understood/repo`, but resolve the real location in your execution environment.

Implement the product, not merely a mockup, plan, screenshot, or browser-only fake backend. Reuse the existing architecture and protections. Deliver working changes in reviewable phases with tests, migrations, runnable local verification, and truthful progress records. Do not stop after writing a plan when implementation is authorized.

This prompt supersedes conflicting product choices in the earlier simplification report and old visual/workflow specifications. In particular, it replaces the four-stage supervisor UI, worker link-only login as the primary method, a supervisor-wide question setting, whole-batch delivery blocking, and an unspecified trial. Existing documents and reference images remain historical evidence; do not delete or overwrite them to conceal differences.

Retain all applicable repository instructions and security/privacy release constraints. Implementing this specification is not permission to buy services, deploy publicly, modify production data, send real invitations/push messages, enable paid AI calls, or process real worker data through an unapproved provider. Complete local/synthetic implementation and clearly identify any external verification gate. Never remove a release guard just to make a screen appear functional.

## 2. Confirmed product decisions

Treat the following as settled; do not reopen them without a concrete conflict or missing prerequisite:

1. Supervisor navigation: **Today**, **Instructions**, **Team**. Reports and Settings are secondary.
2. Supervisor source: record voice, type text, or upload audio, in **English or Arabic**, with automatic source-language detection.
3. Everyday sending: capture source, choose audience, **Send**. Transcription, preparation, translation, speech, question generation, and checking run behind the scenes.
4. Each instruction has **Include a question**, ON by default, beneath the source composer before Send. This is per instruction, not a company or supervisor-wide switch.
5. With the toggle on, create one grounded open question. With it off, require the worker to explicitly **Acknowledge receipt**; no assessment result is implied.
6. Each instruction has **Text only**, **Voice only**, or **Both** delivery. **Both** is the default. Apply the choice to the instruction and its question, if present.
7. Worker answers may be typed or recorded regardless of delivery mode. **Text entry is the default**; Record answer is an obvious alternative.
8. Worker login: **company-specific entry + worker ID + password**. Personal email and recurring private access links are not the main worker authentication method.
9. Staff login: verified work email and password for owners, HR, and supervisors, with protected email recovery.
10. The company/staff interface is **English and Arabic**.
11. The worker interface supports the **14 languages listed in section 7**, with content and audio capabilities tested separately.
12. Workers select their language on first login. Later they **request** a change, which an authorized supervisor must approve. Supervisors can also correct language directly.
13. Approved language changes apply across the worker experience, including existing and future instructions and history. Preserve original evidence; use separately traceable translations/views rather than rewriting historical answers.
14. Workers have **To do** and **Done** tabs and a guided **Listen/read → Answer → Review and send** page. A conversation area appears when help/follow-up exists.
15. Supervisors have three main follow-up actions: **Send clarification**, **Request another answer**, **Resolve**.
16. HR can manage workers, crews, languages, and password resets. HR cannot send instructions or read worker answers/follow-up conversations merely by being HR.
17. Supervisors can manage workers, crews, languages, and resets within their assigned teams, in addition to their operational duties.
18. Personal phones and shared company devices are supported, with safe handoff, unsent-work handling, and clear Finish and sign out.
19. Workers receive web push notifications for new instructions and follow-up. Supervisors receive push and in-app alerts for answers needing follow-up, help requests, language-change requests, and other actionable failures relevant to their scope.
20. Company signup is self-service with ordinary organization details and verified owner email.
21. Trial: **14 days**, **no payment card**, **no automatic charge**, **25 workers per company**, **no fixed instruction-count allowance**. An authorized platform operator can raise the worker limit for a particular pilot.
22. After trial expiry: **read-only**, preserving permitted access to existing records while blocking new instructions and submissions until activation.
23. Pilot paid upgrades use **manual activation**. Payment-provider choice and automated checkout are deferred. No Whish, Stripe, bank gateway, or other payment integration is selected by this prompt.
24. If some language versions fail, deliver the complete ready versions to their intended workers and clearly show the undelivered count. Do not wait for all languages and do not claim every worker received the instruction.
25. Retain recognizable Understood branding while improving layouts simply: clearer hierarchy, spacing, wording, focus, and navigation, with fewer decorative controls.

## 3. Required initial audit

Before implementation:

- Read applicable instructions, `UNDERSTOOD_SPEC.md`, the newest `BUILD_STATUS.md` and `docs/READINESS.md` entries, and relevant current code. Older progress estimates are not authoritative current acceptance evidence.
- Inspect Git status, runtime commands, current migrations, services, and dirty/untracked files. Preserve unrelated changes. Do not reset, clean, reseed, restart, migrate, or rebuild a running saved environment blindly.
- Confirm the actual stack and dependencies from the lockfile. The reviewed stack is React/TypeScript/Vite, Node 24, native Node HTTP services, SQLite local functionality, PostgreSQL repositories/runtime, PGlite tests, private storage, database jobs, and a separate operator service. Do not replace it with a new framework or authentication vendor just to simplify the UI.
- Inventory affected interfaces, schema checks, locale allowlists, provider capability allowlists, jobs, private storage families, database grants, backup/import/restore, privacy cleanup, and tests.
- Record a phased implementation plan and requirement-to-evidence checklist. Clearly distinguish pre-existing features, changes implemented now, and externally unverified features.

Primary integration areas include:

| Area | Existing code/documentation |
|---|---|
| Customer shell/navigation | `src/main.tsx`, `src/entry.tsx`, `src/staff-policy.ts`, locale and style modules |
| Public entry/setup | `src/PublicProduct.tsx`, `src/Onboarding.tsx`, onboarding and workspace-bootstrap repositories |
| Composer/publication | `src/NewBriefing.tsx`, `src/SourceAudio.tsx`, `src/PublishForm.tsx`, `src/DraftSteps.tsx`, briefing domain/preparation modules |
| Worker identity and sessions | `server/auth-crypto.mjs`, local/PostgreSQL auth, `server/session-context.mjs`, account and worker modules |
| Worker presentation | worker components in `src/main.tsx`, recorder/player/submission/help/device/offline modules, `src/worker-ui-language.ts` |
| Team | `src/People.tsx`, `src/SiteCrews.tsx`, worker import/access controls, local/PostgreSQL people repositories |
| Follow-up | Clarifications, ClarificationActions, CaseConversation, CaseRepeats, CaseReviews, StaffCaseRecordings, case repositories |
| Reporting/billing | Reports, notifications, usage, manual billing, operator repositories |
| Background/runtime | `server/worker.mjs`, `server/postgres/runtime.mjs`, AI adapters, provider budget, leases, hosted config |
| Data and release | schema/migrations, permission profiles, privacy/retention, backup/import/restore, CI and deploy documentation |

## 4. What to remove, replace, relocate, and preserve

### Remove from ordinary customer workflows

- Seven-item supervisor primary navigation.
- Required Source / AI processing / Languages / Publish progression.
- Manual Process synthetically, language preparation, or technical readiness approval as routine sending tasks.
- Technical job identifiers, provider details, hashes, leases, raw errors, and request ledgers as normal product content.
- Multiple worker inbox categories requiring understanding of Sent versus History versus Follow-up.
- Mandatory staff review or translator approval of every instruction/language/answer.

Remove their prominence or replace the route experience; do not blindly delete underlying services or evidence.

### Replace

- Link-only normal worker entry with worker ID/password authentication and setup/reset.
- Tab-only worker UI locale as the source of truth with server-persisted profile preference and approval workflow.
- Always-assessed instructions with immutable per-instruction response mode: assessed question or acknowledgment only.
- Always-both delivery with immutable per-instruction Text/Voice/Both selection.
- All-language batch blocking with transparent, safely recoverable partial delivery.
- Pure pilot inquiry as the only entry to a real verified owner signup/trial experience.

### Relocate

Reports, detailed version history, templates, company glossary, scheduling, technical diagnostics, private supervisor disagreement, in-person recordings, case ownership/deadline details, audit, privacy, and organization settings remain in context or a secondary More/Settings area, with existing authorization. Operator controls remain isolated from customer navigation and authentication.

### Preserve

Existing organizations, worker identities, crews, source files, publications, assignments, attempts, receipts, case messages, assessments, recordings, audit history, retention policies, and provenance. Preserve frozen evidence, tenant/site checks, private media authorization, replay safety, session context, version/revision guards, job leases, quotas, and backup/restore protections. No business records are deleted merely to simplify screens.

## 5. Company discovery, registration, trial, and activation

### Public website

Explain: send instructions in workers' languages; receive voice/text answers; follow up when needed. Use clear **Get started**, **Sign in**, and a truthful example. Keep branding but avoid long technical AI explanations or unsupported promises. Staff-facing public copy supports English and Arabic.

Get started opens company registration, not an unlabelled simulated sale. In explicitly synthetic mode, label fixtures/demonstrations and intercept delivery without exposing live verification links publicly.

### Registration and owner verification

Collect owner full name, work email, password, company name, operating country, and required terms/privacy acknowledgment. Optional fields such as business contact number can be nonblocking unless required by the actual pilot policy. Do not require card data, provider keys, worker uploads, or complex site setup to create a trial.

Verify email control before activating owner privileges. Use short-lived one-use verification credentials, hashed storage, generic public responses, bounded resend/attempt budgets, private delivery, and idempotent registration/verification. Verification proves mailbox control, not legal employer authority. Do not attach the registrant to an existing company because an email domain matches or permit a public role dropdown to grant ownership.

Create the organization, first site, owner account/membership, trial, and audit coherently. Proposed engineering default: start the 14-day clock on successful verified workspace activation, measured as 14 × 24 hours by server time, displayed locally. Refreshing, changing email, or replaying registration must not restart the trial.

### Short onboarding

Ask for first site name/timezone, default staff interface language, then show **Add your team** and **Create your first instruction**. One-site customers should not need to navigate a site hierarchy. Keep further sites and contacts in Settings. Detect timezone only as a suggestion; persist a valid confirmed value.

### Trial capacity

Use 25 active company worker identities, including workers pending initial setup; count across sites rather than granting 25 per site. This is an explicit engineering interpretation of the agreed cap. Preserve disabled worker history and uniqueness. Creation/import/reactivation must enforce capacity transactionally, including simultaneous requests. Return a useful capacity message rather than partially importing unexpectedly.

No fixed commercial instruction-count limit applies to the trial. Keep bounded input sizes, concurrency/rate controls, fraud/abuse protection, and provider budgets. Do not promise unlimited paid external compute, silently purchase quota, invent readiness, or replace a provider failure with a fake success. Expose real temporary unavailability in plain language.

### Expiry and read-only

Show days remaining and a clear **Request activation** action. At exact expiry, enforce read-only on the server for new business activity, including instruction sends, new answers, acknowledgments, repeats, and conversation/help writes. Existing permitted records/reports remain readable subject to ordinary retention and authorization.

Continue login/logout, necessary credential recovery, security revocation, legally/operationally required privacy handling, expiry/cleanup, and safe settlement/reconciliation of already-dispatched work. Read-only is not a blanket permission to disable security controls or retention. A received answer can settle its already-accepted check without inventing a new submission; newly queued delivery cannot bypass the current entitlement gate.

Retain unsent local work with explicit status where permitted. Recheck entitlement before upload admission, dispatch, publication/recipient release, and submission acceptance. Do not show Sent for paused work. Define idempotent recovery across expiry/activation races.

### Manual paid activation

Company owners request activation through a durable scoped record. Display pending/active/read-only state truthfully. Only an authorized platform operator or explicit maintenance procedure can activate a company for an agreed period, record plan/terms/reference, and audit it. A customer owner must not activate their own subscription by changing client state or posting a payment screenshot.

Use immutable request IDs, expected revision, confirmed operator action, expiry timestamps, and replay-safe receipts. Activation, extension, suspension, and expiry transitions are separate from payment collection. Do not invent plan prices or automatically mark invoices paid. Existing manual billing is a ledger, not proof of bank settlement or a complete platform entitlement system.

No live payment integration is required in this pilot prompt. Leave payment gateways deferred; do not insert dummy checkout or a buy button that falsely confirms a purchase.

## 6. Accounts, roles, and team scope

### Staff authentication

Owner, HR, and supervisor use verified email/password and protected email recovery. Reuse current salted scrypt patterns, generic authentication errors, persistent throttle budgets, hashed random session tokens, HttpOnly cookies, hosted Secure/host-only policy, same-origin checks, and session-context fencing. Credentials never enter logs, analytics, client storage, source, or ordinary DTOs.

Use the existing credential policy as the baseline; review it against current guidance before any new policy decision. Passkeys, SSO, or a new MFA deployment are not selected by these product decisions. Preserve existing MFA if discovered and document recommended staff hardening separately rather than pretending it is implemented.

### Capability table

| Capability | Owner | HR | Supervisor | Worker |
|---|---|---|---|---|
| Subscription/settings and staff role grants | Authorized company scope | Only explicitly permitted directory settings | No subscription/role control | No |
| Add/edit/disable workers and crews | Authorized scope | Assigned directory scope | Assigned team scope | No |
| Worker credential reset | Authorized scope | Assigned directory scope | Assigned team scope | Request assistance only |
| Worker language administration | Authorized scope | Assigned directory scope | Assigned team scope | First choice; later request |
| Approve worker language-change request | Acting as authorized supervisor | No approval merely from HR role | Assigned team scope | No |
| Send instructions / inspect answers / follow up | Authorized operational scope | No | Assigned operational scope | Own assignments/replies only |
| Private rubric/recordings/notes | Current specific permissions | No via HR role | Current specific permissions | No staff-private data |
| Platform activation/provider control | Separate operator authority only | No | No | No |

Preserve auditor read-only behavior where it already exists; do not silently grant write or private-audio rights. Map HR carefully to the current restricted administrator model, adding explicit authorized directory/reset functions where missing. A job title is not proof of authority.

Existing site-level supervisor scope may be broader than “assigned teams.” Model and enforce explicit crew/team grants or an explicitly assigned whole-site scope. Do not implement team restrictions solely by filtering frontend lists. Every selected worker, import, reset, answer read, case, push recipient, and retry must recheck server authority.

### Worker identity and credentials

Team → Add worker collects display name, company-unique worker ID, and optional crew. Support existing imported identities and workers with no chosen language. Record Not selected yet rather than falsely claiming a default was selected. Keep normalized uniqueness documented; an ID from another company must never authenticate into this one.

Use a company-specific login URL/locator to supply organization context. The locator is public routing information, not a secret. Do not rely on company codes as an authentication factor.

Proposed implementation default: issue a high-entropy, short-lived temporary password or one-use setup credential, display it once privately to authorized staff, and force the worker to create their own password before accessing private instructions. Reuse secure async hashing and token practices. Never derive passwords from names, IDs, phone numbers, company names, or shared team PINs.

Staff can initiate reset after the company's real-world identity check. Reset cannot reveal the old password; it invalidates old sessions/setup credentials and issues a new one-use setup credential. Audit actor, target, scope, and result without the plaintext secret. Brute-force limits are scoped to company/account and validated client address; guard both setup and normal login.

If a worker spans sites, choose and document one organization-level credential identity with explicit site memberships. Do not create competing passwords or merge identities based on matching names. Existing worker grants can remain a controlled migration/setup route, but normal access becomes worker ID/password. Grant expiry must not inadvertently govern a new password-authenticated session.

HR and supervisors can view worker access status, reset, or disable within scope. Disabling revokes access but preserves history. Re-enabling does not resurrect previous sessions/temporary secrets. Deletion remains separately authorized and privacy-accounted.

## 7. Language requirements

### Staff and source

The public/company/staff interface supports English and Arabic with complete labels, errors, help, dialogs, date/time, notifications, and accessibility text. Supervisor source input supports English/Arabic for typed, recorded, and uploaded input. Detect language automatically, handle mixed/unclear input honestly, and request correction when detection or transcription is unreliable. Do not silently pretend all source languages work.

### Worker languages

Required languages are:

| Language | Suggested self-name | Base language tag |
|---|---|---|
| English | English | en |
| Arabic | العربية | ar |
| Hindi | हिन्दी | hi |
| Urdu | اردو | ur |
| Bengali / Bangla | বাংলা | bn |
| Malayalam | മലയാളം | ml |
| Tamil | தமிழ் | ta |
| Telugu | తెలుగు | te |
| Nepali | नेपाली | ne |
| Filipino / Tagalog-based | Filipino | fil |
| Sinhala | සිංහල | si |
| Russian | Русский | ru |
| Punjabi | ਪੰਜਾਬੀ / پنجابی | pa, with explicit script variant |
| Indonesian | Bahasa Indonesia | id |

Treat Punjabi script as an explicit locale/capability decision; do not show Gurmukhi to every Pakistani Punjabi speaker or assume all Punjabi is Urdu. Support both Gurmukhi and Shahmukhi presentation variants where the selected provider supports them, or document the remaining variant as unverified rather than mislabelling it. Provider tags can differ from UI tags; map them deliberately. Do not call every Philippine language Filipino or infer language from nationality.

The list is a user-selected product requirement, not a measured top-14 statistical ranking. Research informed its starting point, but no worker's nationality proves their preferred language or Arabic proficiency.

### UI versus content capabilities

Translate the entire worker interface: onboarding, login, forms, dates, recorder, playback, answer status, help, follow-up, profile, language requests, device choice, notifications, failures, receipt recovery, limits, and sign-out. No critical raw-English fallbacks in a supposedly localized path. Use maintainable locale resources and language-aware fonts, direction, line breaks, pluralization, and mixed-direction IDs.

Keep an internal capability registry for UI, translation, source/answer transcription, instruction/question/follow-up speech, and assessment. Test each independently. Do not add codes to a dropdown and call the language complete. Expand database CHECK constraints, strict DTOs, import/export validation, privacy/retention, audio notices, and tests beyond current en/ar/ur allowlists.

Real provider support for all 14 languages is an acceptance requirement, not a fact already established. Implement the full UI and safe capability handling locally; use clearly labelled synthetic fixtures for unsupported external tests. Do not substitute fake speech, uncertified translations, or a forced different language to claim completion.

### First choice and later requests

First successful worker setup asks Which language do you prefer? Display each language in its own script, update presentation direction immediately, and persist the selection server-side across devices. Require explicit selection before normal instruction delivery; workers without a choice appear in audience eligibility with a clear remedy.

Later, Profile → Language offers Request language change. A request contains requested locale, actor/scope, current revision, optional brief reason, immutable receipt, and pending/approved/rejected status. Avoid duplicate pending requests; show the current state. Keep the current language active until approval. Notify the assigned supervisor; show approval/rejection to the worker. Only a currently authorized supervisor/operational owner approves; HR administration does not silently bypass this request workflow.

Supervisor direct correction remains available and audited. Serialize conflicting direct correction and approval; a stale request cannot revert a newer choice. Revalidate session context and worker caches without silently discarding unrelated drafts or switching identity.

### Apply to everything without destroying evidence

After approval, use the selected language for UI, new instructions, questions, follow-up, notifications, and viewing existing instructions/history. Original source, published versions, assignment language, question/rubric, accepted answers, audio, and assessments remain immutable evidence.

Create traceable translated presentation artifacts keyed to the original version/message and approved locale. Completed work stays completed; translated viewing is not a new assignment or assessment and must not inflate denominators. Original worker answers remain available as originals; any displayed translation is labelled and separately attributable. Never present generated translated audio as the worker's original recording.

For an unanswered item, explicitly bind the new presented language/question to the next accepted answer with provenance so assessment can identify what was actually asked; preserve the original assignment/version link. Do not silently reuse a snapshot whose bindings claim a different language. Use a migration/domain design reviewed against reporting and repeat workflows.

Generate historical presentation translations lazily/as needed rather than sending all history to providers immediately. Pending/failed translation shows a clear state; do not silently fall back while claiming everything is updated. Read-only entitlement must allow authorized reading and safe retrieval without unbounded new billable generation; define how preapproved cached translations or paused generation behave honestly.

## 8. Supervisor screens and composition

### Today

Attention-first, not technical analytics. Show Needs follow-up, Waiting for answers, Language requests, Could not send/partly sent, and recent instructions. Counts have explicit authorized scope and version/audience semantics. Primary action: New instruction. A help card links directly to its worker/instruction context. Do not mix acknowledgment-only completion with AI match.

### Instructions

Search, concise filters, paging, draft/scheduled/preparing/sent/partly sent/withdrawn/archive states, and response progress. Open an item to see recipient status, original content/version, answer or acknowledgment, and follow-up. Put History, Reports/export, Copy, Schedule, Withdraw, Archive, optional advanced review, and template use under contextual More controls with suitable confirmations.

### Team

Workers, crews, search, scoped status, capacity, Add worker, Import workers, language, language-request status, and access reset. Existing CSV validation/preview/explicit commit is retained. No plaintext passwords in CSVs, exports, error reports, ordinary lists, or logs. Imports and restores respect 25-worker entitlement without silent partial writes.

### Composer

One understandable page: Record / Type / Upload; valid preview; optional title; recipients/crews; Include a question (on); Delivery format (Both); Send. Place the toggle beneath the source input and before Send as requested. Optional deadline, reminder, schedule, and advanced content controls sit in More options. Saving a draft is distinct from Send.

Retain source limits unless deliberately changed and documented: the current composer has bounded text, source audio up to 90 seconds/10 MB, and bounded audience size. Show limits before failure. Handle microphone permission, disconnect, unsupported codec, interrupted upload, cancel, preview, rerecord, and unsent navigation without hidden recording or silent loss.

Auto-title/source detection cannot fabricate facts. Ambiguous or empty content must request correction. Before Send the supervisor can inspect/edit; after Send edits create a new captured operation/version, not an unannounced rewrite of delivered material.

## 9. Automatic Send and partial delivery

Accept a durable immutable Send request binding actor, company/site/team scope, source revision/hash and language, selected recipients, crew membership provenance, target preferences, question mode, delivery mode, deadline/reminder/schedule settings, and request ID. Resolve crew membership at capture time; later joiners are not added implicitly.

Prepare source transcription, grounded facts, one open question and private rubric when enabled, per-language translation and consistency checks, and the required speech. Question-off mode must not fabricate a hidden assessed requirement. Voice-only still has secure internal transcription/grounding, but the worker's ordinary presentation follows the selected format. Provide accessible, explicitly requested alternatives without relabelling them as the original delivery choice.

Deliver a recipient only once all artifacts required by that recipient's selected mode are ready. For Both with a question, instruction text/audio and question text/audio must all be ready; do not label a missing-audio partial item complete. Text only must not wait for unnecessary TTS. A common-source/facts failure blocks everyone; a target-language failure need not block ready target languages.

Use a frozen logical publication/version and captured audience with per-recipient release status, or an equivalently audited model. The design must allow later successful recipients to join that original captured audience without relaxing arbitrary audience immutability. Existing publication constraints cannot simply be dropped. Keep one logical instruction, version linkage, and truthful denominators; do not create a new publication per retry and inflate totals.

Track per-recipient or equivalent cohort states such as Preparing, Available, Failed, Blocked, Withdrawn, with immutable delivery receipts and validated language/media bindings. Show **Sent to 18 of 25; 7 not delivered**, not Sent to all. A worker sees only released assignments. Notify only newly available recipients; retry cannot resend notifications/assignments to already-delivered recipients.

Recheck current actor authority, team/site access, active worker, language revision, deletion, trial/subscription, tenant/provider pause, quota, current lease, and captured source dependencies at dispatch and attachment. If language changes during preparation, reconcile explicitly rather than silently altering the original confirmed payload.

Existing database-backed jobs and private storage should drive the workflow; do not run a long chain in a browser or a serverless request. Preserve request journals, retries, backoff, safe lease recovery, conservative uncertain-call accounting, artifact integrity/readback, and response-size/time limits. Provider keys stay server-only. Browser speech is not a substitute for approved generated audio.

The ordinary UI uses Preparing, Sent, Partly sent, Scheduled, Could not send, and a focused retry action. Retry binds the original accepted command and retries only eligible unfinished work. A lost response checks its receipt first. Do not silently repeat an external call whose result is uncertain.

## 10. Worker home, guided form, acknowledgment, and follow-up

### Home

Phone-first header: worker name, current language/profile, notifications, device/account controls, and prominent Finish and sign out for shared mode. Two tabs: **To do** and **Done**.

To do includes released instructions needing an answer or acknowledgment and actionable follow-up/repeat requests. Done means no current worker action is needed; it is not comprehension certification. An accepted answer with pending checking can appear there with Answer received — checking. New follow-up returns the item to To do as Reply needed. Do not duplicate one instruction across multiple competing inbox categories.

Cards show translated title, sender, optional deadline, concise status, and Open. Retain permitted older versions in history/details. No coworkers, private rubric, staff notes, routing reasons, operator controls, or raw errors.

### Instruction form

1. Listen or read: show text/audio according to captured delivery choice, with accessible playback and explicit alternatives.
2. If question enabled: show/play the one question according to that mode. Default answer UI is a text field with character limit and **Record answer** alternative.
3. Recording: permission on interaction; notice; timer; stop; preview; rerecord/discard; explicit Send answer. No auto-send, covert recording, or implication that playing audio proves attention.
4. Text: retain valid draft safely, show limits, send explicitly.
5. No question: replace the answer form with **Acknowledge receipt**. Record an immutable explicit acknowledgment tied to worker, assignment/version, and receipt; do not create an AI assessment or matched answer.
6. **I need help** remains available before/after answer or acknowledgment, subject to current admission.

Question-enabled instructions cannot be completed by acknowledgment alone. Question-disabled instructions do not expose a meaningless answer box. Receipt acceptance is distinct from assessment. Enforce the frozen mode on the server; changing a draft toggle cannot change an existing assignment's requirements.

### Outcomes

Use Saved on this device, Sending, Answer received — checking, Matches the key points, Supervisor follow-up needed, Acknowledged, and checking delayed where accurate. Unclear/transcription/provider failures must not imply the worker was wrong. Assess against actual question/rubric/version, require validated evidence, and never default to match.

### Help/conversation

A help request may be voice or text and is separate from an assessed answer. Create/reuse an eligible scoped case without duplicates. Reveal the conversation section only when help/follow-up exists. Reply input defaults to text with record alternative. Preserve original messages and translations; no new native notification can expose their contents on a shared lock screen.

Conversational replies are not automatically assessed attempts. **Answer again** opens the guided answer form only for an actionable repeat request. A repeat retains the assignment, original response history, and frozen instruction semantics. Acknowledgment-only follow-up cannot invent a required assessment without a new explicitly confirmed instruction/version.

## 11. Supervisor follow-up and worker language approval

Open attention from Today or Instructions → worker. Show original instruction/version, answer/audio, plain reasons/evidence, and relevant history. Keep deeper provenance in details. Primary actions:

- **Send clarification:** typed message with optional recording capability as already supported; automatic translation/audio where configured and appropriate. Queued generation is not delivered. Do not deliver untranslated content as if it matched the worker's preference.
- **Request another answer:** explicit deadline where needed; same assignment/case; previous attempt preserved; one actionable request per admission rules. This can extend response admission past the original deadline without rewriting that original deadline.
- **Resolve:** short human note, closure receipt, and notifications. It records follow-up completion, not a changed AI assessment or certified understanding.

Record disagreement, assign owner, change case follow-up deadline, inspect timeline, or save in-person staff recordings through More options. All remain staff-private with current role rules. A later match does not automatically resolve a case. A concurrent resolution/withdrawal/session change can block a new reply; accepted exact retries still recover their original result.

Language requests are separate actionable items. Approve/reject with expected current preference/revision and reason where useful. Recheck worker and scope and preserve exact receipts. Direct corrections and pending approvals cannot race to overwrite one another.

## 12. Notifications on browsers and phones

Implement genuine server-backed web push for supported browsers/devices, plus persistent in-app notifications. Phone notifications here mean supported web-app push, not an assumed SMS or native-mobile-app integration.

Workers: new available instruction; clarification/follow-up; requested repeat; language request decision; meaningful deadline reminder where configured. Supervisors: answer requiring clarification or unassessable answer, help request, worker follow-up requiring action, language-change request, overdue/actionable item, failed/partial send requiring attention. Deduplicate events; avoid alerts for every internal processing stage or a fresh alert on unchanged polling.

Ask browser permission contextually after explaining it. Browsers and operating systems control permission; never claim guaranteed delivery. If denied/unsupported, preserve usable in-app inbox, show how to enable notifications where appropriate, and do not block login or answering. Document installation requirements for target phone browsers using current primary documentation during implementation.

Subscriptions bind authenticated identity, scope, device/session policy, and endpoint. Enforce authorization/origin/context for create/update/remove. Treat push endpoints/keys as private data. Verify server events before fanout; recheck recipient access. Unsubscribe/revoke account binding and clear worker-specific notifications on shared-device signout as supported. Handle one endpoint reused by another worker without delivering old-worker events.

Default lock-screen notification text is generic, e.g. “You have a new instruction” or “An item needs your attention.” No names, answer text, sensitive titles, rubric, or audio links in payloads. Clicking requires fresh authentication and scoped navigation; never include bearer access tokens in a public notification URL.

Use an outbox/event identity, retry/backoff, expired subscription cleanup, and sent/accepted/uncertain accounting. Push-service acceptance is not proof a person saw it. Credentials such as application-server push keys remain server-side, separate by environment. Test real external delivery only with authorization; synthetic adapters must be visibly labelled in verification evidence, not shown as real phone delivery.

## 13. Shared devices, offline, and recovery

Offer Personal device or Shared device; default to shared. Reuse existing explicit consent, session fencing, encrypted bounded IndexedDB/outbox, and cross-tab worker locks. Do not introduce automatic private caching on shared devices.

Warn before leaving with unsent text/audio. Allow explicit finish/save/clear choices supported by current policy. Recordings remain local until explicit Send; local-only saving is not server receipt. Reconnecting checks current worker, assignment, deadline, response mode, entitlement, and original receipt before upload. No silent background resend.

Finish and sign out ends the server session, stops audio/capture, unmounts private content, removes or invalidates private local data and worker notification bindings, and verifies supported cleanup. Cleanup failure is visible; do not claim complete device erasure. Support security logout even if network unavailable, explaining any server-revocation uncertainty. Do not permit the next worker to inherit a prior password, answer draft, offline bundle, push binding, recording notice, or account-scoped receipt.

Use persistent transaction receipts for uncertain business writes, not repeated clicks/new UUIDs. Keep generic technical details out of the normal path. A contextual **Check status** followed by an eligible **Retry** can wrap the existing operation-specific exact receipt logic. Never clear unresolved evidence because a response is malformed or a later retry is rejected.

## 14. Records, reporting, lifecycle, and secondary tools

Reports and instruction detail must distinguish captured audience, preparing/not delivered, available/delivered, answered, acknowledged, matched, follow-up needed, pending check, and human resolved. State denominators visibly. Never count an unreleased assignment as a worker failing to respond. Do not count translation-view artifacts as new assignments, answers, or successful assessments.

Preserve original assignment and publication language in historical exports, and separately expose later approved presentation language only if clearly labelled. Existing historical records without a new field remain honestly Unknown/Legacy rather than invented. Reports and CSV must preserve formula neutralization and authorized private downloads/expiry.

Editable draft changes never mutate a sent version. Corrections create a new version or explicitly traced reissue. Withdrawal stops new business admission for affected released/pending recipients while preserving received evidence. Archive closes further operational use according to existing semantics; do not invent restoration if not implemented. Trial expiry is read-only, not deletion or archive.

Keep templates, glossary, scheduling, invoices, audit, privacy settings, and account/site selection as secondary functions with retained contracts. Source terminology changes invalidate dependent drafts, not historical evidence. New privacy deletion and retention handling must cover names, credentials/setup tokens, language requests, translated viewing artifacts/audio, acknowledgments, send deliveries, push subscriptions/outbox, exports, backups, and local recovery. Application-current-view cleanup is not proof of provider-history, backup, or device erasure.

## 15. Schema, migration, API, and permission work

Design additive, transactional migrations and rollback/recovery procedures before running them. Implement in the supported adapters or explicitly gate unsupported features; never let SQLite/demo and PostgreSQL silently claim equivalent functionality when they differ.

Required concepts include:

- Verified staff signup/email-verification and resumable company activation.
- Organization trial/entitlement with 25-worker limit, operator override, activation/expiry ledger, and exact receipts.
- Worker display names, organization-level credentials/site membership, setup/reset state, credential revision, session mode and revocation.
- All 14 languages and necessary Punjabi script variants across constraints, strict inputs, DTOs, locale resources, and capability registry.
- Server-side worker preference and immutable language-change request/decision ledger.
- Separate traceable presentation translations for existing/history content.
- Immutable Send options: question mode, delivery mode, source locale, captured audience and language revisions.
- Per-recipient delivery/release state and receipts under a frozen logical version/audience.
- Acknowledgments distinct from assessed attempts.
- Team-scoped staff grants where existing site permissions are too broad.
- Authenticated push subscriptions, deduplicated notification events, delivery outbox, and cleanup.

Use validated contracts, bounded payloads/search/pages, stable IDs, relational integrity, atomic audit, and expected revisions. Public DTOs whitelist fields. Reject caller-supplied tenant/role/provenance where authority must come from the session. Private media native GETs must retain cookie/scope checks without assuming custom headers are always possible.

New tables/columns/functions require matching API, worker, operator, and maintenance permission profiles. Keep the operator without private-storage/AI/mail handles and raw worker content. Background workers receive only necessary credential-adjacent powers; password material must not leak into processing queries. Startup checks verify schema and grants; do not give runtime roles ownership or DDL rights to make a migration pass.

Extend synthetic import/export and encrypted/native backup/restore. Preserve identities/history but invalidate or quarantine active sessions, pending setup/reset/verification tokens, notification endpoints, deliveries, and post-backup privacy-sensitive state as appropriate. Reconcile newer deletion/retention/entitlement events before activation. Test credential/login migration from existing worker grants without linking unrelated identities or replaying old notifications/mail.

Existing data may lack names, language selection, question mode, delivery mode, or subscription state. Document honest defaults: retain old assessed/both semantics only where the saved artifacts establish them; do not label unknown history as a new acknowledgment-only instruction. Existing demo/rehearsal workspaces must not be silently given a newly expiring commercial trial or deleted during migration.

## 16. Visual and accessibility acceptance

Retain the Understood name, recognizable wordmark/color identity, and calm visual character. Improve, rather than rigidly copy, obsolete dense reference layouts. Use consistent typography, spacing, clear headings, restrained panels, meaningful statuses, large touch targets, and one clear primary action per task.

Phone-first workers; responsive supervisors; proper English/Arabic staff layouts; proper worker scripts/direction/font support for all required locales. Avoid unnecessary charts, animated decoration, onboarding questions, tabs, and settings in normal flows. Do not use a screenshot as an interface or replace working capture/playback with decorative waveforms.

Verify keyboard/focus, labelled controls/errors, reduced motion, contrast, live status announcements, zoom/reflow, narrow and short screens, long translations, mixed-direction names/IDs, dialogs, touch, microphone permission, and screen-reader behavior. Do not claim WCAG certification from an automated scan. Voice-only delivery needs a deliberately accessible alternative without exposing the private rubric or changing recorded delivery evidence.

Before major layout implementation, produce compact reviewable screen maps using these settled requirements. Proceed with authorized reversible work; do not repeatedly ask the user to reapprove settled product decisions.

## 17. Required acceptance scenarios

Use synthetic, isolated fixtures. Add meaningful regression tests for authorization, new domain states, replay, and concurrency; do not merely mirror implementation strings. Preserve existing tests unless behavior is intentionally changed and the new requirement is tested. At minimum cover:

### Signup, trial, and staff

- Unknown/existing email responses, unverified account, expired/reused verification, email resend abuse, duplicate signup and lost commit acknowledgement.
- No takeover based on matching business domain or public role selection.
- Exactly one owner/company/trial per exact registration; trial does not reset on replay.
- Full 14-day boundary by server time, no card, no auto-charge, no fixed instruction counter.
- 25-worker scope across sites; concurrent add/import/reactivation; explicit authorized override.
- Read-only enforcement across UI and all business write APIs/jobs; security and cleanup remain usable.
- Operator activation authorization, revision conflict, exact replay, expiry/extension, customer denial.
- HR can directory/reset but cannot operationally send/read cases/audio; supervisors cannot escape team scope.

### Worker access and language

- Same worker ID in different companies, wrong company/password, persistent throttling, setup/reset expiry/replay, changed credential revision, disabled/deleted worker.
- First-use replacement before content access; no exposed plaintext password; prior sessions revoked.
- Organization identity/site membership and linked legacy-grant migration without unwanted access.
- First language choice persists across login/devices; all worker UI strings and notices localized.
- Later change remains pending until authorized approval; duplicate request, rejection, supervisor correction race, revoked approver, stale expected language.
- Approved preference updates new and historical presentation without rewriting original answer/assessment/version, changing Done status, or inflating metrics.
- Missing/failed history translation and unsupported voice handled honestly; original recording versus generated translation labelled.

### Send and media

- English/Arabic source detection, mixed/empty/ambiguous source, microphone denial/disconnect, invalid audio/limits, unsent preview retained.
- Text/Voice/Both default and combinations with question on/off; immutable mode validated server-side.
- One generated grounded open question, private rubric, no required human signoff, invalid provider evidence cannot pass.
- Empty/foreign/inactive audience, page-selection semantics, captured crews, worker language not yet selected, concurrent source/audience/language changes.
- Partial language failure: ready recipients delivered once, failures visible, original captured audience retained, only failed work retried.
- Both-mode missing audio blocks that recipient; text-only does not wait for speech; common-source failure blocks all.
- Lost Send ACK, process restart/lease expiry, uncertain external result, paused provider, tenant/site/trial expiry, withdrawal during delayed completion.
- No duplicate publication/assignment/reminder/push on exact retry, no false Sent count.

### Worker answers, acknowledgment, and cases

- Worker sees only released own assignments; correct presented language/question/version binding.
- Text answer default, voice alternative independent of delivery mode, recording preview/explicit send and alternate text on denied microphone.
- Acknowledgment-only has explicit receipt and no fake attempt/match; question-enabled cannot complete via acknowledge endpoint.
- Lost submission/upload ACK and changed-payload replay; answer retained when check delayed; empty/unassessable evidence never auto-matches.
- Help before/after answer/acknowledgment; same eligible case deduplicated; help not a successful answer.
- Conversation only when relevant, voice/text reply, ordinary reply not an assessed repeat.
- Repeat admission/deadline, previous attempts retained, original deadline unchanged, one actionable request, closure/withdrawal race.
- Resolve keeps original assessment, disagreement stays private, later match does not silently close a case.
- Unsent draft, held old view, cross-tab account/site change, stale owner/deadline/review writes and recovery preserve correct intent.

### Notifications, shared device, reports, and restore

- Real supported web-push integration contract and separately labelled synthetic adapter; permission denied/unsupported has usable inbox fallback.
- Event fanout only to currently authorized recipients, generic payload, no raw titles/answers/secrets.
- One event per actual recipient release/follow-up; no polling/retry spam; invalid subscription cleanup and bounded retry.
- Shared endpoint worker switch/signout never routes old-worker notifications or click-through data to the new worker.
- Personal/shared policy, active capture on expiry, offline draft vs receipt, stale session reconnect, failed cleanup and safe handoff.
- Report denominators for partial delivery; acknowledgment, answered, matched, case resolved distinguished; language/view artifacts not duplicated assignments.
- Formula-safe private CSV and expiry; privacy deletion covers new artifacts/credentials/push; native and object backup/restore retains evidence without reviving tokens or erased content.
- Built browser flows at phone/desktop widths, all locales/RTL, keyboard and real device/audio/push acceptance where available.

## 18. Execution phases and deliverables

Implement in dependency order, retaining a durable checklist:

1. **Audit and contracts:** reconcile current code, role/team scope, trial/response/media/delivery state models, migration plan, screen map, source-of-truth status.
2. **Navigation and form:** Today/Instructions/Team, contextual follow-up, two-tab worker home, text-default guided form; preserve existing backend safeguards.
3. **Identity/onboarding/languages:** worker passwords/setup/reset, names, verified staff signup, first-use language, requests/approval, locale resources/capabilities and historical translated presentation model.
4. **Automatic Send:** captured operation, question/media modes, automatic jobs, acknowledgment path, safe per-recipient release/partial delivery, mode-aware reports.
5. **Trial/manual entitlement:** verified owner workspace creation, 14-day/25-worker trial, read-only enforcement, operator manual activation and recovery.
6. **Notifications and device integration:** scoped web push/in-app outbox, shared-device cleanup/handoff, repeat/follow-up/language notifications, reminder integration.
7. **Integration and release preparation:** schema/permission parity, backup/restore/privacy, native PostgreSQL races, full meaningful tests, browser/device/locale checks, truthful readiness report.

Adjust phase boundaries only for real dependencies; do not claim a visual-only phase satisfies authentication, automatic Send, push, or production readiness. Finish one usable vertical slice at a time rather than creating every screen as a nonfunctional placeholder.

Maintain BUILD_STATUS.md with actual work, commands/results, pending operations, known defects, and one next task. Update feature traceability and runbooks. Mark earlier simplification assumptions superseded by this prompt, but preserve historical evidence. Never copy an old pass count into a claim of current verification.

Run appropriate focused tests after behavior changes, then the repository build/typecheck and full suite when integrated. Current scripts include `npm run typecheck`, `npm run build`, `npm test`, shard testing, and synthetic evaluations; verify their current definitions before execution. Use native PostgreSQL for concurrency/role claims; PGlite serialization alone is insufficient. Capture real browser evidence against built assets, not only source checks.

Final implementation handoff must provide:

- What changed, what was removed from everyday screens, what was relocated, what was reused.
- Working local commands and safe synthetic accounts/fixtures through an appropriate private handoff; never publish live passwords/tokens.
- Migration/rollback and compatibility notes, preserved data, deployment/configuration needs.
- Actual commands/results, remaining failing tests/skips, limitations and evidence paths.
- Locale/capability matrix distinguishing UI complete, provider contract tested, live synthetic verified, and real-data approved.
- Push/device evidence distinguishing service acceptance from visible actual device notification.
- Commercial state implementation and manual activation procedure without a selected payment gateway.
- Remaining external provider, email, hosting, monitoring, privacy/security, native/device, and deployment-approval gates.

The intended result is a simpler interface over reliable existing foundations: the supervisor sends, the worker reads/listens and responds or acknowledges, and the supervisor acts on meaningful follow-up. Do not weaken those foundations to make the interface look finished.

## 19. Research context for the language shortlist

The user explicitly selected the final 14 languages. The shortlist was informed by worker migration origins and regional community evidence, not a universal ranked language census:

- [ILO Labour Migration in Asia report, including GCC deployment origins](https://www.ilo.org/sites/default/files/2024-06/labour-migration-asia-trends-skills-seasonalwork-2024-en.pdf)
- [Embassy of India in Bahrain: community background](https://eoibahrain.gov.in/india-bahrain-bilateral.php)

Use current primary provider/platform documentation to verify language, notification, authentication, and library support during implementation. These demographic sources do not prove provider capability or any individual's language proficiency.

## 20. Status of this document

This prompt records the approved product direction and explicit engineering defaults. It was written after source review and clarification. It does not mean the application has been redesigned, tests rerun, a company provisioned, a payment account connected, a provider enabled, or the service deployed.
