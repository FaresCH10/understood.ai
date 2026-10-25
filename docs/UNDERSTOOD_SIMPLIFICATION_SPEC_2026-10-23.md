# Understood: simpler SaaS experience and implementation specification

> Historical comparison draft. The later [complete implementation prompt](UNDERSTOOD_IMPLEMENTATION_PROMPT_2026-10-23.md) supersedes its proposed defaults where they conflict, including trial rules, worker languages, per-instruction question/media choices, approved language changes, push notifications, and partial delivery. Preserve this document as review history; use the later prompt for implementation.

Date: 23 October 2026  
Purpose: compare the existing application with the experience agreed in this conversation, and specify the changes needed.  
Status: design and source-review document; application changes have not been implemented by this review.

## 1. Product direction

Understood helps supervisors communicate instructions across languages and follow up when workers need assistance.

The everyday experience must be simple:

1. The supervisor records, types, or uploads an instruction.
2. The supervisor selects workers or crews and presses **Send**.
3. Understood automatically transcribes, prepares translations and audio, and creates an open question grounded in the instruction.
4. The worker receives the instruction in their selected language.
5. The worker follows a guided **Listen/read → Answer → Review and send** form.
6. Understood checks the answer against the exact instruction the worker received.
7. Where follow-up is needed, the supervisor sends a clarification, requests another answer, or resolves the issue.

AI processing remains behind the scenes. Users see understandable delivery and answer states, not pipeline stages, provider controls, technical jobs, or preparation approvals.

This is a simplification of the existing product. Keep its authorization, private storage, immutable history, request recovery, and duplicate prevention. Do not replace those protections with a superficial demo.

## 2. What was agreed, and what is still a proposal

### Confirmed direction from the conversation

- Make the SaaS substantially simpler for supervisors and workers.
- Support voice recording, typed source instructions, and audio upload.
- Run transcription, translation, speech, question generation, and assessment automatically.
- Workers receive translated text and available voice content.
- Workers choose a language when first signing in; supervisors can correct the choice.
- Use **worker ID and password**, rather than personal email, as the primary worker login.
- Support personal phones and shared company devices.
- Use a guided worker form; show a conversation area when follow-up is needed.
- Allow supervisor clarification, another assessed answer, and human resolution.
- Keep previous answers and assessment history.
- Follow the accepted discovery-to-company-setup-to-team-to-instruction journey.
- Put routine supervisor activity in **Today**, **Instructions**, and **Team**. Reports and settings are secondary.

### Proposed defaults in this specification

These make implementation concrete, but are not claims that the user selected every detail:

- Use “Instruction” consistently in the main UI. Existing database/API names may remain “briefing.”
- Staff initially use the existing email/password foundation; add verified company signup and appropriately protected recovery. Passkeys/MFA remain a separate staff-authentication choice, not a settled worker-login requirement.
- Use a company-specific login address to disambiguate worker IDs between companies.
- Provision short-lived temporary worker passwords privately; require replacement on first use.
- Default to shared-device mode unless the worker explicitly chooses a personal device.
- Capture source, recipient selection, recipient language, and revision when Send is accepted; publish only after the captured batch is ready.
- For the first release, prevent silent partial delivery: incomplete preparation blocks delivery of that batch, with a clear remedy. If partial delivery is later desired, design explicit recipient-level confirmation and status first.
- Classify **Done** as “no current worker action needed,” not proof of understanding. A pending assessment can appear there as “Answer received — checking.”
- Keep multi-site setup, scheduling, templates, terminology, and reports under secondary or contextual controls.

### Commercial and operational decisions still open

- Plan names, prices, trial policy, usage limits, billing provider, and cancellation rules.
- Whether company signup is initially self-service or an approved pilot with assisted activation.
- Exact staff MFA/passkey policy and account-recovery ownership.
- Temporary-password lifetime, session timeout values, and shared-device inactivity policy.
- Approved production AI/storage/email providers and supported language/audio combinations.
- Future recovery of workers who belong to multiple sites: preserve their organization identity; do not create conflicting passwords for each site.

Do not invent prices, enable paid services, connect accounts, deploy, send real messages, or process real worker data while implementing a local design.

## 3. Review basis and limits

This document is based on the current source checkout, including pre-existing modified and untracked files, and project documentation. It is not a new browser usability test or an independent security assessment. No application tests or build were rerun for this document. Earlier reviews inspected the authentication, HTTP routes, domain, worker, AI adapters, UI, and deployment configuration.

Latest readiness notes record local synthetic verification and explicitly keep production approval open. Historical documentation contains superseded statements; use current source and the newest entries in BUILD_STATUS.md and READINESS.md.

Important current evidence:

- Frontend navigation has seven primary destinations.
- Draft creation exposes four steps: Source, AI processing, Languages, Publish.
- Worker credential access uses expiring one-use grants, not worker passwords.
- Worker UI language is stored in session-scoped browser state; changing it explicitly does not change assigned instruction languages.
- Workers currently have a code/language record; first-class worker display names and password identities need design/schema work.
- The public product page directs people to a pilot inquiry rather than self-service company registration and checkout.
- Manual invoices and payment records are implemented; this is not subscription checkout or entitlement processing.
- Hosted runtime configuration only permits synthetic staging and rejects ordinary live content-pipeline activation.

## 4. Current versus required experience

| Area | Current implementation | Required change | Reuse |
|---|---|---|---|
| Public website | Product page, walkthrough, pilot inquiry, sign-in | Clear Get started and Sign in; truthful company signup or assisted activation | Public shell, inquiry validation, receipt recovery |
| Company creation | Maintenance bootstrap and resumable owner setup | Verified owner-facing company creation with secure activation | Transactional workspace bootstrap concepts |
| Subscription | Manual billing ledger and illustrative plan/usage views | Chosen plan, subscription state, trusted billing events and entitlements | Existing ledger only where its semantics fit |
| Supervisor navigation | Overview, Briefings, Clarifications, People, AI processing, Reports, Settings | Today, Instructions, Team; secondary settings/reports | Existing role and site scope |
| New instruction | Save source, process, inspect languages, choose publish | Capture source, choose audience, Send | Capture/upload/editor/recipient components |
| Processing | Customer job queue and manual preparation controls | Automatic durable orchestration, plain user status | Jobs, leases, retries, quotas, provenance |
| Language preparation | Site defaults and separate artifact screens | Determine required content languages automatically | Translators, audio, glossary snapshots |
| Worker authentication | Private link redemption | Company login + worker ID + password, first-use reset | Hashing, session cookies, revocation, throttling patterns |
| Worker identity | Organization-unique code and language | Name, worker ID, account status, password setup state | Worker scope and directory |
| Worker language | Interface preference can be tab-local; profile language is separate | Persist first-login preference on server; supervisor correction | Locale dictionaries and directory language editing |
| Worker home | Inbox with To do, Sent, History, Follow-up distinctions | Two clear tabs: To do and Done | Assignment/response read models |
| Worker detail | Existing listening, recording, help, status, history, conversation components | One guided form; follow-up conversation appears when needed | Private playback, recorder, receipts |
| Clarification queue | Separate full navigation destination | Today attention cards and instruction-context follow-up | Cases, routing, deadlines, timeline |
| Supervisor approval | Human resolution already distinct from AI outcome | Resolve with note; never relabel original AI evidence | Resolution and disagreement ledgers |
| Another answer | Repeat-answer workflow exists, primarily PostgreSQL | Simple Request another answer action | Repeat deadline/admission/receipt logic |
| Failed requests | Many operation-specific recovery screens | Short contextual recovery panels | Exact immutable receipts and explicit retry |
| Shared devices | Substantial session fencing, local-device policy, cleanup | Simple first-use mode choice and Finish and sign out | Encryption, unsent guards, cross-tab locks |
| Production operation | Synthetic-only gates and outstanding release checks | Separately approved real-data runtime and production evidence | Hosted packaging and permission checks |

## 5. Roles and navigation

### Company owner

Creates the workspace, controls subscription, invites staff, grants site access, and manages organization policies. Owner privileges must come from verified onboarding or an existing owner's invitation, not a role dropdown on public signup.

### HR / team administrator

Manages permitted workers, crews, access provisioning, and resets. “HR” is a user-facing job description, not automatic authority to read answers or recordings. Map it to the existing restricted administrator capability set where suitable. Add any missing administrative endpoints deliberately; do not silently give HR supervisor or owner access.

### Supervisor

Sends instructions to authorized teams, checks response activity, handles follow-ups, corrects worker language, and requests another answer or resolves cases. Worker credential-reset authority must be explicitly scoped and audited if assigned to supervisors.

### Worker

Can access only their own assigned instructions, answers, and permitted follow-up. Cannot see coworkers, staff-only notes, private rubric, or organization controls.

### Platform operator

Retains a separate origin, identity, permissions, and console. Simplifying customer navigation must not merge platform controls into customer settings.

### Main supervisor shell

- **Today:** attention-first summary and New instruction.
- **Instructions:** sent/preparing/draft/history list and creation.
- **Team:** workers, crews, language, access.
- Secondary menu: Reports, workspace settings, account, sign-out.
- Owner/admin-only management remains accessible under appropriate settings.
- Site selector is visible only when useful; one-site companies should not face an unnecessary selection step.

## 6. Full company journey

### 6.1 Discovery

The public page explains the three outcomes: send instructions across languages, receive answers in workers' own words, follow up when needed. Show a simple representative example. Use **Get started** and **Sign in** as clear actions.

In a synthetic demo, Get started must truthfully open a demonstration or pilot request until secure self-service signup exists. Do not simulate a purchased subscription.

### 6.2 Owner signup

Collect owner name, work email, company name, and credential setup. Verify control of the email before activating owner privileges. Email verification is not proof of legal authority over an employer or its domain. Do not attach someone to an existing organization merely because an email domain matches.

Bound and throttle signup, verification, resend, and recovery. Reject account-enumerating responses. Exact retries must not create another company or another owner account.

### 6.3 Subscription

Display only real configured plans. If a trial is chosen, state its actual limits and end date. For paid signup, use the selected provider's hosted checkout; do not collect raw card data in this app.

Activation depends on verified server-side provider events or an explicitly authorized manual entitlement, not the checkout return page. Deduplicate events and handle delayed, repeated, out-of-order, failed, cancelled, and refunded states according to the chosen commercial policy. Keep subscription state separate from staff identity and company membership.

### 6.4 Short setup

Ask for first site/workplace name and timezone. Start with one site. Offer **Add team** and **Create first instruction**. Keep language-provider checks, storage configuration, quotas, and other technical prerequisites outside the customer wizard.

Do not claim that a short wizard makes an unconfigured production pipeline ready. If the service cannot send instructions, show a plain availability message and retain drafts.

### 6.5 Staff invitations

Owner invites a staff member by email, with clear role and site scope. Existing invitation expiry, acceptance proof, encrypted delivery, revocation, and receipt protections remain. Acceptance must never grant owner authority based on self-selected role text.

## 7. Team, names, and worker access

### 7.1 Add or import workers

Team offers **Add worker**, **Import workers**, and **Crews**. Add worker collects display name, worker ID, and optional crew. Language can be unknown until first login; show **Not selected yet** rather than pretending that a default was chosen by the worker.

Maintain unique worker IDs within the company, with documented normalization. A company-specific login page supplies company context; duplicate IDs in different companies must not collide. Existing active workers retain their current profile language during migration.

CSV should support the new name/ID model and optional language, preserving existing strict validation. Validate and preview before explicit confirmation. Never place bulk plaintext passwords in ordinary error exports or logs.

### 7.2 Initial password setup

Proposed approach: authorized staff issue a short-lived, random temporary password or a one-use setup credential. The worker replaces it before private instructions become available. Setup must bind the existing worker identity; the worker must not claim any worker ID through public registration.

Show initial credentials once and deliver them privately. Store only secure hashes. Never use names, worker IDs, company codes, or one shared team password as the secret. A company login address is a locator, not an authentication factor.

Use asynchronous password hashing, persistent abuse controls, secure HttpOnly sessions, server-side account checks, and session-context fencing. Adopt the existing cryptographic primitives where appropriate rather than inventing weaker ones. Numeric device PINs used by passkeys are not interchangeable with short server-side passwords.

### 7.3 Login

At the company login page show **Worker ID**, **Password**, and **Sign in**. Provide staff sign-in as a distinct option. Successful first-use login opens password replacement, language choice, and device mode. Returning workers go directly to their instructions unless setup is incomplete.

If workers can belong to multiple sites, credentials should bind an organization-level worker account with explicit site memberships; do not use ambiguous site-local password copies. Scope and migration need a design review before implementation.

### 7.4 Forgotten password

Workers without email need a clearly labelled **Ask your supervisor to reset access** path. Authorized staff verify the person through the company's established process, issue a new one-use setup credential, and revoke prior sessions/setup credentials. Do not reveal or recover the previous password. Audit the reset without storing the plaintext secret.

Staff recovery remains a separate verified-email flow. Account restoration must not resurrect revoked sessions.

### 7.5 Language

On first login, ask **Which language do you prefer?** Show language names in their own script and apply the chosen layout direction immediately. Persist the choice server-side across sessions and devices.

By default the same preference drives interface language and future instruction language. If the existing technical model retains separate values, synchronize them through an explicit command; a sessionStorage locale change is insufficient.

The supervisor edits language at **Team → worker → Language → Save**. Revalidate or rotate affected session context and cached views safely. Newly sent instructions use the corrected preference.

Previously published assignments remain frozen. Proposed remedy for a wrong-language existing instruction: an explicit **Send in corrected language** action creates a traceable replacement/reissue, without rewriting old answers or silently resetting denominators. Exact mechanics need implementation design; do not mutate old publication snapshots.

### 7.6 Device mode

Ask **Personal device** or **Shared device**; use the safe shared default. Personal mode may offer explicit bounded private local saving. Shared mode does not persist new private content by default.

**Finish and sign out** ends the server session and attempts verified cleanup of local private stores, pending identity metadata, and playback/capture resources. Warn about unsent work first. If cleanup fails, report it and block silent handoff; do not claim remote wipe or erase browser/OS data outside application control. Inactivity policy must account for active recording and warn rather than silently discard work.

## 8. Supervisor Today

Today answers: **What needs my attention?**

- **Needs follow-up:** unanswered help, incomplete/unassessable answers, worker replies.
- **Waiting for answers:** count and list, with overdue distinction.
- **Could not send:** failed preparation/delivery with one useful action.
- **Recent instructions:** concise progress and links.
- Primary action: **New instruction**.

Counts must have defined site, audience, version, and latest-answer scope. Avoid a large dashboard of implementation metrics. “Sent” means available in the worker's authenticated inbox, not read or understood. “Answered” and “Matches key points” remain separate.

## 9. Supervisor Create and Send

### 9.1 Composer

One composer supports **Record**, **Type**, and **Upload**. Provide source preview, discard/rerecord, character/duration/size limits, and draft save. Use a reasonable generated title only when grounded; workers should not see a fabricated title while processing is incomplete.

Support only approved source-language combinations. Source-language detection/configuration can be automatic, but ambiguous or unsupported input must produce a clear correction action. The existing English-only source selector cannot be relabelled as arbitrary multilingual support.

### 9.2 Audience

Select workers and/or crews, with search and a complete selected-recipient count. Crew selection resolves a snapshot of eligible members, including their delivery languages. No Select this page control may imply selection of the entire filtered directory.

Disable Send when the audience is empty, source invalid, site archived, authority expired, or required service unavailable. Preserve a valid draft and explain the remedy.

### 9.3 Optional settings

Place deadline, reminder, schedule, and advanced content review under **More options**. Default reminders must match actual notification channels. In-app notification scheduling is not proof of SMS, email, push delivery, or worker attention.

### 9.4 One Send command

Send creates a durable request before remote work, binding actor, scope, source revision, audience, language choices, and optional timing. The screen can then show **Preparing** and allow safe navigation once server acceptance is confirmed. Unknown acceptance invokes recovery first.

Background work performs transcription if needed, grounded facts/question/rubric preparation, translation consistency checks, and speech generation. Persist the frozen version and assignments atomically when valid and authorized. Existing private objects must be validated before attachment.

Recheck actor authority, worker eligibility, site state, deletion fences, quota/provider availability, and accepted dependency hashes at dispatch and completion. An explicit Send is permission for that captured operation; a later draft edit is not permission to send changed content to that original audience.

No manual **Process synthetically**, language preparation checklist, or publication approval is part of ordinary sending. Advanced review remains optional before Send; detected ungrounded/ambiguous source must still stop delivery and request correction.

### 9.5 Send status

Use **Draft**, **Preparing**, **Sent**, **Scheduled**, **Could not send**, and **Withdrawn** where relevant. Show text such as “Preparing the languages your team needs.” Do not expose lease IDs, provider hashes, raw errors, or rubric.

Start with whole-batch delivery after required preparation succeeds. If a language fails, state that delivery has not completed. “Try again” must retry the accepted operation with receipt/attempt checks. A provider-uncertain result must not cause blind duplicate paid calls. If the pipeline can partially commit for any reason, reflect actual recipient-level state rather than claiming nothing was sent.

## 10. Worker screens

### 10.1 Home

Header: worker name, language control, account/device menu, and clear Finish and sign out on shared devices.

Tabs:

- **To do:** instructions needing an initial answer, actionable help/follow-up, and requested repeat answers.
- **Done:** no current worker action required; show pending checks, matched results, and retained completed history truthfully.

Each card shows translated title, supervisor, optional deadline, and a short status. A new relevant follow-up moves the item to To do as **Reply needed**. Counts derive from actionable state, not stored pending flags alone.

### 10.2 Guided instruction form

1. **Listen or read:** instruction audio, translated text, basic playback controls, optional deadline.
2. **Answer the question:** readable/playable open question; **Record answer** and **Type instead**.
3. **Review and send:** preview, rerecord/discard, and **Send answer**.

Keep **I need help** available before and after an answer. Allow a short typed or recorded explanation through the existing protected help path. A help request is not an assessed answer or completion.

The question must ask about the instruction's relevant facts, not ask whether the worker understood the question. Private rubric/correct answers stay staff-only. Playback is not attention evidence.

### 10.3 Submission

Distinguish **Saved on this device**, **Sending**, **Answer received — checking**, **Matches the key points**, and **Supervisor follow-up needed**. Technical failure should say “Your answer was received, but checking is delayed” where that is the actual state.

An unclear/unassessable answer must not be presented as matched or as worker misconduct. Keep original receipt, attempt, instruction version, language, and question bindings. Do not erase a later unsent draft when an earlier receipt is recovered.

### 10.4 Follow-up

Only show the conversation section when help/follow-up exists. Display supervisor messages, translated text/audio where configured, and Record/Type reply. Use the same item rather than creating a second unrelated inbox entry.

A conversational reply is separate from an assessed answer. **Answer again** opens the guided assessment form when an authorized repeat request exists. Closed cases and expired/revoked access must stop new submissions while retaining permitted history.

## 11. Supervisor follow-up

Open a Today attention item or **Instructions → selected instruction → worker**.

Show the original instruction/version, worker answer and audio, factual assessment explanation, and follow-up history. Keep technical provenance and full audit timeline in details.

Three primary actions:

- **Send clarification:** write a message; translated text/audio is prepared in the background. Say Delivered only when the message is actually available to the worker. Provider failure cannot silently deliver untranslated content.
- **Request another answer:** set a deadline when needed, create the existing repeat request, and return the instruction to the worker's To do list. Preserve original deadline and attempts; do not create duplicate cases.
- **Resolve:** enter a short resolution note and close human follow-up. This never changes the original AI result to Matched.

Owner assignment, case deadlines, private disagreement, staff in-person recordings, and timeline remain under **More options**. Finish/clear unsent work before incompatible actions. If someone else changed the case, preserve the draft and rebase explicitly against current state.

No verified reopen-case behavior is assumed. A future reopen action needs its own admission, audit, and repeat-answer rules.

## 12. Corrections and secondary features

- Edit an unsent draft normally, preserving concurrency checks.
- Changing a preparing item must not silently modify its captured send request; offer an explicit correction/cancel flow based on the operation state.
- Correct a sent instruction through a new version and new explicit audience selection or clearly confirmed reissue. Never silently add crew joiners to an older audience.
- **Withdraw** stops new answers/help for that version; received answers can still finish checking under existing rules.
- **Archive** closes new operational work for the briefing; preserve current irreversible-archive semantics unless separately redesigned.
- Preserve Copy as draft, templates, glossary, reports, exports, scheduling, and audit in contextual or secondary locations.
- Supervisor-facing reports show assigned, received, matched, needs follow-up, and pending-check counts. Resolution is separate from AI match.
- Existing glossary content and recordings retain their original access restrictions even if the screens move.
- Owner billing/subscription management must not appear as an ordinary supervisor task.

## 13. Implementation map

| Workstream | Existing files to inspect/reuse | Required work |
|---|---|---|
| Public/company entry | src/PublicProduct.tsx; src/Onboarding.tsx; server/onboarding.mjs; server/postgres/workspace-bootstrap.mjs | Real signup/verification/activation; short setup; no fabricated checkout |
| Navigation | src/main.tsx; src/entry.tsx; src/staff-policy.ts; locale/style files | Three primary destinations; secondary menus; preserve role/site locking |
| Composer | src/NewBriefing.tsx; src/SourceAudio.tsx; src/PublishForm.tsx; src/DraftSteps.tsx | One capture/audience/send experience; optional settings |
| Send orchestration | server/domain.mjs; server/preparation.mjs; server/worker.mjs; server/postgres/domain.mjs; server/postgres/preparation.mjs; server/postgres/runtime.mjs | Durable captured Send command and automated stage-to-publication orchestration |
| AI | server/ai; server/postgres/provider-budget.mjs; server/postgres/hosted-config.mjs | Preserve grounding/quota/provenance; approve a real-data provider path separately |
| Worker credentials | server/auth-crypto.mjs; server/auth.mjs; server/postgres/auth.mjs; session-context code | New worker credential/setup/reset storage and routes; scoped rate limiting; current authority checks |
| Worker profile/language | server/people.mjs; server/postgres/people.mjs; src/People.tsx; src/worker-ui-language.ts | Display name, server-side onboarding language, explicit supervisor correction |
| Worker form/home | src/main.tsx; WorkerRecorderView; WorkerAudioPlayer; WorkerSubmissionReceipt; WorkerHelpHub; worker navigation/state modules | Two-tab inbox; one guided form; conditional conversation |
| Follow-up | Clarifications; ClarificationActions; CaseConversation; CaseRepeats; CaseReviews; StaffCaseRecordings | Three main actions; secondary details; preserved admission/receipt contracts |
| Shared/offline | worker-device-policy; worker-local-data; worker-offline; useWorkerSessionGuard | Simplified device choice/signout using existing safety mechanisms |
| Reports/settings | Reports; WorkspaceSettings; StaffAccess; StaffInvitations; PlanUsage | Secondary placement; honest entitlements; role-scoped controls |
| Data/migration | server/db.mjs; server/postgres/migrations; backup/import/retention modules | Add credentials/profile/send ledger safely; preserve history and restore invalidation |

Use current repository conventions. File references identify integration areas, not an instruction to replace every file or rewrite the stack.

## 14. Data and migration requirements

1. Preserve organizations, sites, crew memberships, publication snapshots, assignments, attempts, cases, audit, and immutable request receipts.
2. Add worker display name and explicit account/setup state through additive migrations. Preserve worker IDs/code uniqueness.
3. Separate private credentials from public worker DTOs. Add password change/setup expiry and session-revocation accounting.
4. Decide organization-level worker identities before multi-site credential rollout; document how existing worker records link.
5. Existing private links may remain a controlled migration/setup path; they must not bypass forced password setup or create a second unconstrained identity.
6. Existing sessions need a deliberate transition policy. New login cannot weaken active-worker, site-access, tenant-suspension, or deletion checks.
7. Add immutable Send request bindings and a durable orchestration state. Link them to existing jobs, publications, receipts, and provider operations.
8. Extend backup/import/restore to include intended identity structure while excluding or quarantining secrets according to existing restore policy. Do not restore active temporary credentials or silently reactivate sessions.
9. Extend privacy cleanup to new display names, credential/setup state, send metadata, exports, and local recovery where applicable. Minimal provenance must not retain deleted plaintext unnecessarily.
10. Update API/worker/operator database grants and exact permission checks for every new table/column/function. Do not give the worker or operator broad credential or customer-content access.

## 15. Failure and edge-case acceptance matrix

| Case | Required user experience and invariant |
|---|---|
| Duplicate company signup / lost acknowledgement | Resume the same verified request; one organization, owner, and entitlement effect |
| Signup email unknown/unverified/expired | Generic safe response; no owner privileges until valid verification |
| Existing company email domain | No automatic company membership or takeover |
| Payment return succeeds but event absent | Show activation pending; no invented active subscription |
| Repeated/out-of-order billing event | Idempotent validated entitlement transition |
| Staff invitation revoked/expired | No acceptance; request a new valid invitation |
| Same worker ID in another company | Correct company context; no cross-company authentication |
| Incorrect worker password | Generic error; persistent scoped throttling |
| Temporary password expired/reused | Controlled reset/setup path, no private content access |
| Worker changes initial password | Revoke setup credential and prior sessions atomically |
| Staff resets wrong worker / stale scope | Fresh authority and identity confirmation; deny wrong scope; audit accepted reset |
| Disabled/deleted worker | Deny login and submissions; restoration never revives old credentials/sessions silently |
| Language not selected | First-use selection required before normal inbox entry |
| Supervisor changes language during capture | Preserve safe unsent-state rules, fence stale submission, explain recheck; do not adopt another context silently |
| Previously assigned language differs | Show frozen assignment language truthfully; offer explicit reissue if implemented |
| Unsupported language/provider | Block affected delivery with a clear remedy; no fake translation or speech |
| No recipients / all disabled | Preserve draft; explain eligibility; no empty successful send |
| Crew changes after Send | Captured audience remains traceable; no silent additional recipients |
| Source edited after Send | Old operation cannot publish new inputs under old confirmation |
| Microphone denied/disconnected | Offer Type or Upload; preserve previous valid preview |
| Oversized/unsupported audio | Bounded validation and clear correction message |
| Transcription ambiguous/empty | Request correction; do not fabricate question/facts |
| Translation or speech fails | No false Sent; safe retry of original captured operation |
| Provider result uncertain | Conservative accounting and reconciliation; no blind duplicate billable dispatch |
| Worker/API process restarts | Durable state recovers under lease rules without duplicate publication |
| Send receipt lost | Check original receipt before retry; no new audience/version created accidentally |
| Scheduled instruction not yet delivered | Scheduled is distinct from Sent; cancellation result is verified |
| Deadline/timezone/DST error | Explain local time; require valid unambiguous instant |
| Worker receives instruction | Only own scope, frozen version, correct content and question language |
| Worker requests help without answering | Case/help recorded; no fabricated answer or completion |
| Duplicate answer upload | One receipt/attempt for exact request; changed payload conflicts |
| Answer received but assessment fails | Show received/check delayed; retain answer; bounded safe retry |
| Empty/unreliable answer | Unassessable/follow-up; never automatic match |
| Answer matches facts | Record immutable result; no competence/safety certification claim |
| Supervisor requests another answer | One actionable request; same assignment/case; previous attempt preserved |
| Original deadline passed | Only valid repeat admission permits new answer; no blanket extension |
| Case resolved while worker replies | Server rechecks closure; exact already-accepted replay can recover |
| Supervisor disagrees with AI | Private disagreement retained; original outcome unchanged |
| Resolution saved | Case closes; metrics do not silently convert AI outcome to match |
| Concurrent owner/deadline/resolution update | Reject stale writes, retain user draft, offer clear recheck |
| Unsent draft blocks navigation | Explain why and offer explicit keep/clear choices; no silent discard |
| Shared-device switch | Old view, audio, recording, cache, and authority cannot leak into new identity |
| Shared cleanup fails | Report incomplete cleanup; no false device-clear confirmation |
| Offline answer | Explicit local-only state; no Sent/Received until actual server receipt |
| Session revoked while offline | Cached state cannot authorize new online access; reconnect revalidates |
| Withdraw/archive during processing | Recheck admission; preserve historical receipts; stop prohibited new actions |
| Export expired or privacy-redacted | No stale private download; clearly request a new eligible export |
| Subscription restricted/suspended | Truthful scope-aware restrictions; do not bypass retention/privacy or hide recovery history |
| Arabic/Urdu and narrow phone | Correct direction, script, labels, focus, audio states, no clipped required controls |

## 16. Delivery sequence

### Phase 1: lock the product contracts

Write the Today/Instructions/Team navigation, status definitions, guided worker form, role capabilities, captured Send behavior, and migration decisions. Resolve commercial and production-provider choices separately. Keep existing source and reference assets as history; the new user-authorized simplification takes precedence where the earlier four-step UI conflicts.

### Phase 2: simplify using existing services

Build the three-area supervisor shell, contextual follow-up, two-tab worker home, guided form, and secondary settings/report placement against existing scoped services. Preserve all receipt and session guards. This phase improves usability but does not yet satisfy worker password login or automatic Send.

### Phase 3: worker identity and onboarding

Add names, organization-scoped credentials, first-use replacement, reset, persistent language, supervisor correction, and device choice. Integrate across HTTP, permissions, privacy, backup, import, and restore. Verify old-link migration separately.

### Phase 4: automatic Send

Implement durable source/audience capture, automatic preparation, dependency-bound publication, clear failure states, and exact-request recovery. Use synthetic isolated fixtures first. Do not enable production dispatch by relaxing existing hosted gates.

### Phase 5: company onboarding and subscription

Implement verified owner registration and resumable short setup, then the chosen billing/entitlement integration. A usable approved manual pilot can precede automated checkout, but the UI must label it honestly.

### Phase 6: integrated verification and release preparation

Run domain, HTTP, client, native PostgreSQL concurrency/permissions, backup/restore, privacy, and full workflow tests. Exercise actual built browser journeys on phone/desktop, shared devices, RTL, interrupted connections, microphone denial, and session changes. Real-data provider quality/privacy, delivery services, deployed monitoring, and release approval remain explicit gates.

Do not assign invented completion percentages or calendar estimates. Record implemented, locally verified, device verified, provider verified, and production approved separately.

## 17. Definition of success

- A supervisor can create and send an instruction without visiting a processing, language-preparation, or publication screen.
- A worker can sign in through their company using worker ID/password on supported personal or shared devices.
- First-use language selection is remembered across devices and is correctable by authorized staff.
- A worker can listen/read, answer by voice/text, preview, and send in one guided page.
- Help and follow-up stay attached to the original instruction.
- A supervisor can clarify, request another answer, and resolve with three understandable actions.
- No user has to understand jobs, hashes, provider operations, leases, or receipts to complete the normal path.
- Failures expose one clear next action while keeping the underlying exact-request safeguards.
- Version history, audience scope, assessment evidence, authorization, privacy, and shared-device isolation remain intact.
- Company onboarding/subscription displays real verified state, not a simulated sale.
- “Sent,” “Received,” “Matched,” and “Resolved” have distinct truthful meanings.
- Production is claimed only after the relevant release gates pass; a visual simplification is not production approval.

## 18. Primary source index

- [Current build status](../BUILD_STATUS.md)
- [Current readiness](READINESS.md)
- [Original product specification](../UNDERSTOOD_SPEC.md)
- [Customer app and navigation](../src/main.tsx)
- [Public website](../src/PublicProduct.tsx)
- [New briefing composer](../src/NewBriefing.tsx)
- [Four draft steps](../src/draft-flow.ts)
- [Publication form and recipients](../src/PublishForm.tsx)
- [Worker entry](../src/WorkerAccessEntry.tsx)
- [Worker interface language storage](../src/worker-ui-language.ts)
- [Local authentication](../server/auth.mjs)
- [Password cryptography](../server/auth-crypto.mjs)
- [PostgreSQL authentication](../server/postgres/auth.mjs)
- [Local schema](../server/db.mjs)
- [Local publication and answer domain](../server/domain.mjs)
- [PostgreSQL domain](../server/postgres/domain.mjs)
- [Hosted synthetic restrictions](../server/postgres/hosted-config.mjs)
- [Company maintenance bootstrap](WORKSPACE_BOOTSTRAP.md)
- [Staff invitations](STAFF_INVITATIONS.md)
- [Current worker entry language behavior](WORKER_ENTRY_WELCOME.md)
- [Worker shared-device policy](WORKER_SHARED_DEVICE.md)
- [Worker offline protection](WORKER_OFFLINE.md)
- [Repeat-answer workflow](CASE_REPEATS.md)
- [Human review and deadline changes](CASE_REVIEWS.md)
- [Manual billing limits](MANUAL_BILLING.md)

The review created this document only. Existing code, configuration, databases, running services, and release restrictions were not changed.
