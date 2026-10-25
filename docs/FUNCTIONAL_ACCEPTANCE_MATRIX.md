# Functional acceptance matrix

Created 25 October 2026 for release-gate G1. This matrix reconciles the agreed product
contract in `UNDERSTOOD_IMPLEMENTATION_PROMPT_2026-10-23.md` with the current implementation
and evidence. It is not a readiness percentage and does not authorize a deployment.

Status codes:

- **L** — passed for the local synthetic scope: SQLite and/or embedded-PGlite tests, plus
  built-browser evidence where named, and (where stated) a disposable native PostgreSQL 16.15
  run. It does not prove a production-major native PostgreSQL run, a deployed system, real
  data, a real provider or a physical device.
- **P** — passed for the embedded-PostgreSQL scope only. SQLite explicitly hides the control
  or lacks the route; the difference is stated in the row.
- **O** — open local work.
- **E** — awaiting external approval, credentials, accounts, devices or independent review.

Evidence identity: `main` at `e8cd359775a2e9113aecd6db610f5088837e1147` plus the dirty
working-tree fingerprint in `artifacts/release-fingerprint-2026-10-25.json` (method and
exclusions recorded there; not a frozen candidate). The latest standard full suite on this
tree was **not clean**: 1,489 tests / 1,484 passed / 0 failed / 4 skipped / 1 cancelled
(3,423,492.6709 ms; `artifacts/production-admission-2026-10-25/full-suite-retry.log`, with
an earlier identical run in `full-suite.log`). The cancellation is
`tests/restore-retention.test.mjs:297`, killed at 301,299.4742 ms by the 300,000 ms
per-test timeout under parallel suite load; it contains no failed assertion. The same file
passed 16/16 in isolation (348,809.8558 ms; affected test 78,180.1132 ms;
`.../restore-retention-retest.log`). This matrix therefore does not claim a clean-suite
certificate. The production-admission tests pass 6/6, and the disposable native PostgreSQL
16.15 checks are recorded under G3-G5. The earlier Phase 7 suite (1,483 tests / 1,479
passed / 0 failed / 4 native skips, 2,737,801 ms;
`artifacts/phase7/full-suite-2026-10-25-summary.log`) remains historical. A fresh full
suite against a frozen candidate is still required before this matrix is reused as release
evidence.

## 1. Registration, trial and activation

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| R1 | Public and staff copy in English and Arabic; truthful synthetic labeling | `src/PublicProduct.tsx`, `src/public-product.css`, staff locale resources | `tests/public-shell.test.mjs`, `tests/public-shell-state.test.mjs`, `tests/report-locale.test.mjs`; built browser checks | L |
| R2 | Get started opens company registration, not a simulated sale | `src/PublicProduct.tsx`, `src/Register.tsx` | `tests/public-shell.test.mjs`, registration browser flow | L |
| R3 | Owner registration collects name, work email, password, company, country, terms/privacy; no card, provider keys or worker uploads | `server/registration.mjs`, `server/registration-input.mjs`, `src/Register.tsx`, `src/registration.ts` | `tests/registration.test.mjs` | L |
| R4 | Email control verified before owner privileges; short-lived one-use hashed credentials; generic public responses; bounded resend; idempotent registration | `server/registration.mjs`, `server/accounts.mjs`, `server/auth-mail.mjs` | `tests/registration.test.mjs`, `tests/invitation-recovery.test.mjs`, `tests/account-recovery.test.mjs`; synthetic mail only | L (synthetic mail) |
| R5 | Organization, first site, owner, trial and audit created coherently; no domain-match takeover or public role grant | `server/registration.mjs`, `server/accounts.mjs`, `server/first-run.mjs` | `tests/registration.test.mjs`, `tests/first-run.test.mjs`, `tests/postgres-registration.test.mjs` | L |
| R6 | Trial is 14 × 24 hours by server time from verified activation; replay/email change does not restart it | `server/entitlement-model.mjs`, `server/registration.mjs` | `tests/registration.test.mjs`, `tests/entitlement.test.mjs`, `tests/postgres-registration.test.mjs` | L |
| R7 | No fixed trial instruction allowance | `server/usage.mjs`, `server/entitlement-model.mjs` | `tests/usage-state.test.mjs`, `tests/usage-allowance.test.mjs`, `tests/entitlement.test.mjs` | L |
| R8 | 25 active worker identities company-wide, including setup-pending; transactional create/import/reactivate | `server/worker-capacity.mjs`, `server/people.mjs`, `server/worker-import.mjs`, `server/entitlement-model.mjs` | `tests/worker-capacity.test.mjs`, `tests/people.test.mjs`, `tests/worker-import.test.mjs` | L |
| R9 | Short onboarding: site name/timezone, staff language, then Add team / Create instruction; one-site customers skip hierarchy | `server/first-run.mjs`, `src/FirstRunOnboarding.tsx`, `src/first-run.ts` | `tests/first-run.test.mjs`; browser onboarding flow | L |
| R10 | Exact-expiry read-only across sends, answers, acknowledgments, repeats, help and conversation writes; security, recovery and cleanup remain usable | `server/entitlements.mjs`, `server/instructions.mjs`, `server/postgres/instructions.mjs`, `server/acknowledgments.mjs`, `server/case-messages.mjs`, `server/clarifications.mjs`, `server/postgres/case-repeats.mjs` | `tests/entitlement.test.mjs` (SQLite and embedded PostgreSQL), `tests/entitlement-activation.test.mjs`, `tests/worker-credentials.test.mjs` | L |
| R11 | Settle already-dispatched work, block newly queued delivery, keep unsent local work truthful, recheck at admission/dispatch/publication/submission | `server/instructions.mjs`, `server/postgres/instructions.mjs`, `server/usage.mjs` | `tests/entitlement.test.mjs`, `tests/usage-state.test.mjs`, `tests/instruction-deliveries.test.mjs` | L |
| R12 | Manual activation by separate operator only; revision/expected state, exact replay, ledger, expiry/extension; owner cannot self-activate | `server/activation.mjs`, `server/operator-input.mjs`, `server/postgres/entitlement-operations.mjs`, `src/ActivationRequestPanel.tsx`, `src/OperatorTenantAccess.tsx` | `tests/entitlement-activation.test.mjs`, `tests/activation-request-recovery.test.mjs`, `tests/operator-tenant-access.test.mjs` | L |
| R13 | No payment gateway, dummy checkout or invoice auto-payment | `server/billing.mjs`, `src/Billing.tsx` | `tests/billing.test.mjs`, `tests/billing-recovery.test.mjs` | L |
| R14 | Days remaining, read-only state and Request activation shown truthfully | `src/PlanUsage.tsx`, `src/ActivationRequestPanel.tsx`, `src/usage-state.ts` | `tests/usage-state.test.mjs`; browser flow | L |

## 2. Staff accounts, roles and scope

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| S1 | Owner/HR/supervisor verified email/password and protected recovery | `server/auth.mjs`, `server/account-recovery.mjs`, `server/invitations.mjs`, `src/AccountRecovery.tsx`, `src/AcceptInvitation.tsx` | `tests/auth.test.mjs`, `tests/account-recovery.test.mjs`, `tests/invitations.test.mjs`; synthetic mail | L (synthetic mail) |
| S2 | scrypt hashes, generic errors, persistent throttle, random hashed session tokens, HttpOnly cookies, same-origin checks, session-context fencing | `server/auth-crypto.mjs`, `server/auth-budget.mjs`, `server/auth.mjs`, `server/session-context.mjs` | `tests/auth-budget.test.mjs`, `tests/session-http.test.mjs`, `tests/session-state.test.mjs`, `tests/staff-session-http.test.mjs` | L |
| S3 | Owner wide scope; administrator/HR directory-only, no operational send, case or private audio; supervisor operational; auditor read-only | `server/staff-schema.mjs`, `server/instructions.mjs`, `server/clarifications.mjs`, `server/reports.mjs`, `server/recordings.mjs`, `server/invitation-input.mjs` | `tests/staff-policy.test.mjs`, `tests/staff-access.test.mjs`, `tests/people.test.mjs`, `tests/report-scopes.test.mjs` | L |
| S4 | HR can directory/reset but cannot send/read cases/audio; supervisor cannot gain private-audio or operational rights from HR role | Same role gates as S3 | `tests/staff-policy.test.mjs`, `tests/worker-credentials.test.mjs`, `tests/recordings.test.mjs` | L |
| S5 | Supervisor scope is an explicitly assigned whole-site scope; no per-crew staff grants exist | `server/staff-schema.mjs` (`site_id` membership), site-scoped queries throughout | Source audit; `tests/people.test.mjs`, `tests/clarifications.test.mjs`, `tests/instructions.test.mjs` | L (scope decision documented; not per-crew) |
| S6 | Invitations: one-use encrypted links, exact replay, resend rotation/cancel, expiry, no elevated-role grant by administrator, disabled accounts invalidated | `server/invitations.mjs`, `server/invitation-input.mjs`, `server/invitation-schema.mjs`, `src/StaffInvitations.tsx` | `tests/invitations.test.mjs`, `tests/invitation-recovery.test.mjs`, `tests/invitation-backup.test.mjs` | L (synthetic mail) |
| S7 | Staff role change rechecks scope, last-owner guard, revokes target sessions atomically | `server/staff.mjs`, `server/staff-input.mjs` | `tests/staff-access.test.mjs`, `tests/people.test.mjs` | L |
| S8 | No passkeys/SSO/MFA claim; existing MFA absent | Documentation only | Source audit; no MFA code | L (honest absence) |

## 3. Worker identity and credentials

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| W1 | Add worker collects display name, company-unique ID and optional crew; imported and unselected identities supported | `server/people.mjs`, `src/People.tsx`, `src/WorkerImport.tsx` | `tests/people.test.mjs`, `tests/worker-import.test.mjs`, `tests/people-http.test.mjs` | L |
| W2 | Company-specific login locator; worker ID is not an authentication factor; foreign-company ID cannot authenticate | `server/worker-credentials.mjs`, `src/WorkerAccess.tsx`, `src/worker-access.ts` | `tests/worker-credentials.test.mjs`, `tests/worker-access.test.mjs`, `tests/worker-access-state.test.mjs` | L |
| W3 | High-entropy one-use setup credential, shown once privately, forced own password; no derived password or CSV plaintext | `server/worker-credentials.mjs`, `server/auth-crypto.mjs`, `src/WorkerCredentials.tsx` | `tests/worker-credentials.test.mjs`, `tests/postgres-worker-credentials.test.mjs`, `tests/people.test.mjs` | L |
| W4 | Reset requires real-world identity check by staff, never reveals old password, revokes old sessions/setup and issues a new one-use credential; audit without plaintext | Same modules | `tests/worker-credentials.test.mjs`, `tests/postgres-worker-credentials.test.mjs` | L |
| W5 | Brute-force limits scoped to company/account and validated client address for setup and login | `server/auth-budget.mjs`, `server/auth.mjs` | `tests/auth-budget.test.mjs`, `tests/worker-credentials.test.mjs` | L |
| W6 | Organization-level credential identity with explicit site memberships; no name merge; grant expiry does not govern password sessions | `server/worker-credentials.mjs`, `server/people.mjs`, migrations | `tests/worker-credentials.test.mjs`, `tests/postgres-worker-credentials.test.mjs` | L |
| W7 | Disable revokes access and preserves history; re-enable does not resurrect sessions or secrets; deletion separate | `server/people.mjs`, `server/deletions.mjs`, `server/postgres/deletions.mjs` | `tests/people.test.mjs`, `tests/deletions.test.mjs`, `tests/postgres-domain.test.mjs` | L |

## 4. Languages

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| L1 | Staff/public interface English and Arabic, complete labels/errors/dialogs | `src/main.tsx`, `src/report-locale.ts`, `src/people-locale.ts`, `src/clarification-locale.ts` | `tests/report-locale.test.mjs`, `tests/people-locale.test.mjs`, `tests/clarification-locale.test.mjs`; staff English built browser; staff Arabic not re-driven in Phase 7 | L (browser partial) |
| L2 | Supervisor source input English/Arabic typed, recorded and uploaded; detection with honest ambiguity/correction | `server/source-audio*.mjs`, `server/ai/*`, `src/NewBriefing.tsx`, `src/SourceAudio.tsx` | `tests/source-transcription-config.test.mjs`, `tests/source-audio*.test.mjs`, `tests/preparation*.test.mjs`; synthetic provider only | L (synthetic source detection) |
| L3 | 15 worker UI locales for 14 languages, including explicit Gurmukhi and Shahmukhi Punjabi | `server/languages.mjs`, `src/worker-ui-language.ts` | `tests/language-registry.test.mjs`, `tests/worker-ui-language.test.mjs`; Arabic RTL 320px built browser | L |
| L4 | Whole worker interface localized; direction, fonts, plurals, mixed IDs; no critical raw-English fallback | `src/worker-ui-language.ts` and worker components | `tests/worker-ui-language.test.mjs`, `tests/worker-notifications.test.mjs`, `tests/worker-presentations.test.mjs` | L (native review pending) |
| L5 | Independent capability registry: UI all; translation/assessment en/ar/ur; transcription/speech en/ar; UI-only locales report unavailable | `server/languages.mjs`, `server/language-readiness.mjs`, `src/LanguageReadiness.tsx` | `tests/language-registry.test.mjs`, `tests/presentations.test.mjs`, `tests/language-artifacts.test.mjs` | L |
| L6 | First-use language choice in native script, persisted server-side, required before delivery; unselected workers excluded with remedy | `server/people.mjs`, `server/postgres/people.mjs`, `src/WorkerAccessEntry.tsx`, `src/worker-access-state.ts` | `tests/worker-language.test.mjs`, `tests/postgres-worker-language.test.mjs`, `tests/instructions.test.mjs` | L |
| L7 | Later language change request: pending/approved/rejected, duplicate prevention, current language stays, supervisor notified, receipt | `server/people.mjs`, `server/postgres/people.mjs`, `server/notification-events.mjs`, worker UI | `tests/worker-language.test.mjs`, `tests/postgres-worker-language.test.mjs`, `tests/notification-events.test.mjs` | L |
| L8 | Only authorized supervisor/owner approves; HR does not bypass; direct correction audited; stale revision/race serialized | Same modules | `tests/worker-language.test.mjs`, `tests/postgres-worker-language.test.mjs` | L |
| L9 | Approved language applies to new and historical viewing via labelled presentation artifacts; originals, versions and assessments immutable; no denominator inflation | `server/presentations.mjs`, `server/presentation-input.mjs`, `src/WorkerPresentationView.tsx` | `tests/presentations.test.mjs` (SQLite and embedded PostgreSQL), `tests/worker-presentations.test.mjs`, `tests/assignment-language.test.mjs` | L |
| L10 | Unanswered instruction binds presented language/question to the next accepted answer with provenance; a mismatched binding cannot be reused | `server/presentation-input.mjs`, `server/recordings.mjs`, `server/postgres/recordings.mjs`, migration 102 | `tests/presentations.test.mjs`, `tests/recording-worker.test.mjs` | L |
| L11 | Historical translation lazy, pending/failed visible, no silent fallback; read-only allows cached reads but pauses billable generation | `server/presentations.mjs`, `server/postgres/presentations.mjs`, `src/WorkerPresentationView.tsx` | `tests/presentations.test.mjs` read-only contract on both repositories | L |
| L12 | Reports/exports preserve captured assignment/source language; presentation language only if clearly labelled; legacy unknown | `server/reports.mjs`, `server/report-scope.mjs`, `server/exports.mjs` | `tests/reports.test.mjs`, `tests/report-scopes.test.mjs`, `tests/exports.test.mjs` | L (presentation language not exported) |
| L13 | Real provider quality/coverage for all 14 languages | No approved provider/data policy | `docs/LANGUAGE_READINESS.md`; synthetic fixtures only | E |

## 5. Supervisor screens, composition and Send

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| C1 | Today is attention-first: follow-up, waiting, language requests, failed/partial sends, recent instructions; scoped counts; no mixed acknowledgment/AI match | `src/main.tsx`, `server/domain.mjs`, `server/postgres/read-models.mjs` | `tests/worker-navigation.test.mjs`, `tests/reports.test.mjs`; built browser | L |
| C2 | Instructions list: search, filters, paging, draft/scheduled/preparing/sent/partly/withdrawn/archive; detail with recipient status, original version, answer/acknowledgment, follow-up | `src/main.tsx`, `src/PublicationHistory.tsx`, `server/instructions.mjs` | `tests/instructions.test.mjs`, `tests/publication-history.test.mjs`, `tests/publication-schedules.test.mjs` | L |
| C3 | Team: workers, crews, search, status, capacity, add/import, language, request status, reset; no plaintext passwords in CSV/exports/logs | `src/People.tsx`, `src/SiteCrews.tsx`, `src/WorkerImport.tsx`, `server/people.mjs` | `tests/people.test.mjs`, `tests/worker-import.test.mjs`, `tests/site-crews.test.mjs` | L |
| C4 | Composer: Record/Type/Upload, preview, optional title, recipients/crews, question on, Both default, Send; options under More | `src/NewBriefing.tsx`, `src/SendInstruction.tsx`, `src/SourceAudio.tsx` | `tests/draft-flow.test.mjs`, `tests/draft-review.test.mjs`, `tests/crew-recipients.test.mjs`; built browser | L |
| C5 | Source limits (90 s/10 MB), bounded text/audience, microphone failure, preview/rerecord/cancel, draft distinct from Send | `src/audio.ts`, `src/source-audio*.ts`, `server/source-audio*.mjs` | `tests/source-audio.test.mjs`, `tests/source-audio-upload.test.mjs`, `tests/audio.test.mjs`, `tests/app-recording.test.mjs` | L |
| C6 | Immutable Send request binds actor, scope, source revision/hash/language, recipients, captured crew provenance, modes, deadline/reminder/schedule, request ID | `server/instructions.mjs`, `server/postgres/instructions.mjs`, `server/instruction-deliveries.mjs` | `tests/instructions.test.mjs`, `tests/postgres-instructions.test.mjs`, `tests/crew-recipients.test.mjs` | L |
| C7 | Preparation: source transcription, grounded facts, one open question, private rubric, per-language translation/speech; question-off invents no requirement; voice-only still internally transcribed | `server/preparation.mjs`, `server/ai/*`, `server/instructions.mjs`, `server/postgres/instructions.mjs` | `tests/preparation.test.mjs`, `tests/prepared-bundle.test.mjs`, `tests/instructions.test.mjs`; synthetic provider | L (synthetic provider) |
| C8 | Recipient delivered once all artifacts for that mode are ready; Both needs audio; text does not wait for TTS; target-language failure is partial | `server/delivery-readiness.mjs`, `server/instructions.mjs`, `server/postgres/instructions.mjs` | `tests/instructions.test.mjs`, `tests/instruction-deliveries.test.mjs`, `tests/postgres-instructions.test.mjs` | L |
| C9 | Common-source failure blocks all; target-language failure does not block ready recipients | Same modules | `tests/instructions.test.mjs`, `tests/instruction-deliveries.test.mjs` | L |
| C10 | Frozen publication/version/audience; late-ready language rejoins without a second publication or inflated totals | `server/publication-history.mjs`, `server/publication-receipts.mjs`, `server/instructions.mjs`, `server/instruction-deliveries.mjs` | `tests/instruction-deliveries.test.mjs`, `tests/publication-receipts.test.mjs` | L |
| C11 | Per-recipient states and receipts; truthful sent/undelivered; only released assignments visible; notify only newly available; retry never duplicates | `server/instruction-deliveries.mjs`, `server/instructions.mjs`, `server/notification-events.mjs` | `tests/instruction-deliveries.test.mjs`, `tests/notification-events.test.mjs`, `tests/postgres-instructions.test.mjs` | L |
| C12 | Recheck actor authority, worker active/language, deletion, trial, provider pause, quota, lease and source at dispatch/attachment | `server/instructions.mjs`, `server/postgres/instructions.mjs`, `server/postgres/provider-controls.mjs`, `server/processing.mjs` | `tests/instructions.test.mjs`, `tests/instruction-deliveries.test.mjs`, `tests/provider-controls.test.mjs` | L |
| C13 | Durable server-side jobs, journals, retries/backoff, lease recovery, uncertain-call accounting, server-only keys | `server/processing.mjs`, `server/processing-retry.mjs`, `server/postgres/preparation.mjs`, `server/postgres/processing-retry.mjs`, `server/ai/*` | `tests/processing.test.mjs`, `tests/processing-retries.test.mjs`, `tests/postgres-lease.test.mjs`, `tests/preparation-progress.test.mjs` | L |
| C14 | UI Preparing/Sent/Partly/Scheduled/Could not send plus focused retry; lost ACK reads receipt first; no duplicate uncertain external call | `src/main.tsx`, `src/publication-recovery.ts`, `server/instructions.mjs` | `tests/instructions.test.mjs`, `tests/preparation-request-recovery.test.mjs`, `tests/publication-receipts.test.mjs` | L |
| C15 | Edits create a new version; withdrawal stops new admission but preserves received evidence; archive semantics; trial expiry does not delete/archive | `server/domain.mjs`, `server/publication-history.mjs`, `server/publication-receipts.mjs`, `server/instructions.mjs` | `tests/briefing-archive.test.mjs`, `tests/publication-history.test.mjs`, `tests/entitlement.test.mjs` | L |

## 6. Worker home, guided form, acknowledgment, help and repeats

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| W8 | Phone-first header with name, language, notifications, device controls, Finish and sign out; To do/Done; no duplicate inbox categories | `src/main.tsx`, worker components, `src/styles.css` | `tests/worker-primary-layout.test.mjs`, `tests/worker-navigation.test.mjs`; Arabic/English built browser at 320/1440 | L |
| W9 | Cards show translated title, sender, deadline, concise status and Open; no coworker/private rubric/staff notes/raw errors | `src/main.tsx`, `server/responses.mjs`, `server/domain.mjs` | `tests/responses.test.mjs`, `tests/worker-state.test.mjs` | L |
| W10 | Read/listen per captured mode with accessible playback and explicit alternatives | `src/WorkerAudioPlayer.tsx`, `src/worker-playback.ts`, `server/responses.mjs` | `tests/worker-playback.test.mjs`, `tests/audio-provenance.test.mjs` | L |
| W11 | Question enabled: show/play one question; text answer default, recording alternative | `src/main.tsx`, `server/responses.mjs`, `server/domain.mjs` | `tests/responses.test.mjs`, `tests/audio-response.test.mjs`, `tests/worker-ui-language.test.mjs` | L |
| W12 | Recording permission on interaction, notice, timer, stop, preview, rerecord/discard, explicit Send; no auto-send | `src/WorkerRecorder.tsx`, `src/worker-recording-notice.ts`, `server/recordings.mjs` | `tests/recording-notice.test.mjs`, `tests/app-recording.test.mjs`, `tests/recordings.test.mjs` | L |
| W13 | Text drafts safe, bounded, explicit Send | `src/worker-text-draft.ts`, `src/WorkerTextDraft.tsx`, `server/responses.mjs` | `tests/worker-text-draft.test.mjs`, `tests/responses.test.mjs` | L |
| W14 | No question: acknowledgment-only with immutable explicit receipt; no assessment/match; question-enabled cannot acknowledge | `server/acknowledgments.mjs`, `server/responses.mjs`, `src/main.tsx` | `tests/instructions.test.mjs`, `tests/entitlement.test.mjs`; server fence at `server/acknowledgments.mjs` | L |
| W15 | Question-disabled exposes no answer box; frozen mode cannot be changed by draft toggle | `src/main.tsx`, `server/responses.mjs` | `tests/instructions.test.mjs`, `tests/postgres-instructions.test.mjs` | L |
| W16 | I need help available before/after answer or acknowledgment, subject to admission | `server/clarifications.mjs`, `src/WorkerHelpHub.tsx` | `tests/clarifications.test.mjs`, `tests/worker-help-history-client.test.mjs` | L |
| W17 | Outcomes honest: saved on device, sending, checking, matches, follow-up, acknowledged; no default match; unclear is not wrong | `server/domain.mjs`, `server/recording-worker.mjs`, `server/postgres/evaluation-observations.mjs`, worker UI | `tests/evaluation.test.mjs`, `tests/postgres-evaluation.test.mjs`, `tests/responses.test.mjs` | L |
| W18 | Help is voice or text, separate from assessment; same eligible case deduplicated; conversation only when relevant; replies default text with record alternative | `server/clarifications.mjs`, `server/case-messages.mjs`, `src/CaseConversation.tsx`, `src/WorkerHelpHistory.tsx` | `tests/clarifications.test.mjs`, `tests/case-messages.test.mjs`, `tests/conversation-request.test.mjs` | L |
| W19 | Conversational replies are not assessed; Answer again only via actionable repeat; repeat preserves assignment/evidence/semantics; ack-only follow-up cannot invent assessment | `server/postgres/case-repeats.mjs` (PostgreSQL only), `server/acknowledgments.mjs`, worker UI | `tests/case-repeats.test.mjs` (embedded PostgreSQL); SQLite detail returns `canRequestRepeat:false`/`canReview:false` and hides both panels | P |
| W20 | Repeat admission/deadline/closure/withdrawal races; previous attempts retained; original deadline unchanged; exact retry | `server/postgres/case-repeats.mjs`, `server/case-*.mjs` | `tests/case-repeats.test.mjs` | P |
| W21 | Resolve records human note/receipt/notification without changing assessment; later match does not auto-resolve; disagreement private | `server/clarifications.mjs`, `server/postgres/clarifications.mjs`, `src/ClarificationActions.tsx` | `tests/clarifications.test.mjs`, `tests/case-reviews.test.mjs`, `tests/report-scopes.test.mjs` | L |
| W22 | Shared device default; personal opt-in; consent/session fencing; encrypted bounded IndexedDB; cross-tab worker locks; no automatic private caching | `src/worker-device-policy.ts`, `src/WorkerDevice.tsx`, `src/usePrivateDevice.ts`, `src/worker-local-data.ts` | `tests/worker-device-policy.test.mjs`, `tests/worker-local-data.test.mjs`, `tests/worker-offline.test.mjs` | L |
| W23 | Unsent work warns before leaving; explicit finish/save/clear; recordings local until Send; reconnect rechecks identity/assignment/deadline/mode/entitlement/receipt; no silent resend | `src/worker-unsent.ts`, `src/WorkerAudioDraft.tsx`, `src/worker-audio-retry.ts`, `src/worker-submission-receipt.ts` | `tests/worker-unsent.test.mjs`, `tests/worker-audio-draft.test.mjs`, `tests/worker-audio-retry.test.mjs`, `tests/worker-submission-receipt.test.mjs` | L |
| W24 | Finish/sign out revokes session, stops capture, unmounts private content, cleans local data and notification bindings, reports failure | `src/main.tsx`, `src/worker-local-data.ts`, `server/auth.mjs`, `server/notification-events.mjs` | `tests/worker-local-data.test.mjs`, `tests/worker-device-policy.test.mjs`, `tests/notification-events.test.mjs` | L |
| W25 | Persistent receipts, contextual status check and eligible retry; evidence is never cleared by malformed responses | `src/worker-submission-receipt.ts`, `src/WorkerSubmissionReceipt.tsx`, `src/worker-request.ts` | `tests/worker-submission-receipt.test.mjs`, `tests/worker-request.test.mjs` | L |
| W26 | Offline private briefing opt-in, expiry, tamper resistance, not authentication; fallback only transport/5xx | `src/worker-offline.ts`, `src/WorkerOffline.tsx`, `src/WorkerOfflineView.tsx` | `tests/worker-offline.test.mjs` | L |

## 7. Notifications and shared-device push

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| N1 | Worker events: instruction available, clarification/follow-up, repeat, language decision, deadline reminder | `server/notification-events.mjs`, `server/notification-event-input.mjs`, worker inbox | `tests/notification-events.test.mjs`, `tests/worker-notifications.test.mjs` | L |
| N2 | Supervisor events: answer needing clarification/unassessable, help, follow-up, language request, overdue, failed/partial send | Same modules, staff notification UI | `tests/notifications.test.mjs`, `tests/notification-events.test.mjs` | L |
| N3 | Deduplicate events; no alert per internal stage or unchanged polling | `server/notification-events.mjs` dedupe keys | `tests/notification-events.test.mjs`, `tests/notifications.test.mjs` | L |
| N4 | Contextual permission request; denied/unsupported leaves usable inbox; never blocks login or answering | `src/usePushNotifications.ts`, `src/Notifications.tsx`, `src/WorkerNotifications.tsx` | `tests/push-notifications.test.mjs`, `tests/worker-notifications.test.mjs` | L (in-app only) |
| N5 | Subscription binds identity, scope, session and endpoint; authorization/origin/context enforced; endpoints treated as private | `server/notification-events.mjs`, `server/postgres/notification-events.mjs`, `src/push-notifications.ts` | `tests/notification-events.test.mjs` (SQLite and embedded PostgreSQL) | L |
| N6 | Fanout rechecks recipient access; generic lock-screen text; no names/answers/titles/tokens; fresh auth click | `server/push-copy.mjs`, `server/notification-events.mjs`, service worker | `tests/notification-events.test.mjs` (generic localized copy), `tests/worker-notifications.test.mjs` | L (synthetic delivery) |
| N7 | Outbox, retry/backoff, expiry cleanup, accepted/uncertain accounting, bounded retries | `server/notification-events.mjs`, `server/postgres/notification-events.mjs` | `tests/notification-events.test.mjs` | L (synthetic delivery) |
| N8 | One endpoint reused by another worker cannot receive old-worker events; signout/deletion/quarantine revokes bindings and cancels queued deliveries | Same modules, `server/deletions.mjs`, `server/postgres/deletions.mjs`, `server/postgres/backup.mjs` | `tests/notification-events.test.mjs`, `tests/postgres-import.test.mjs`, `tests/postgres-backup.test.mjs` | L (synthetic delivery) |
| N9 | Real external web push, OS permission, background/closed-app click, physical Android/iPhone | Existing Web Push/VAPID implementation | No external push or physical device observed | E |

## 8. Reports, records, retention and privacy

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| P1 | Distinguish audience, preparing, delivered, answered, acknowledged, matched, follow-up, pending and human resolved; visible denominators; unreleased never counted as non-response | `server/reports.mjs`, `server/report-scope.mjs`, `src/Reports.tsx` | `tests/report-scopes.test.mjs`, `tests/instructions.test.mjs`, `tests/reports.test.mjs` | L |
| P2 | Translation views are not new assignments/answers/assessments and never inflate totals | `server/presentations.mjs`, `server/reports.mjs` | `tests/presentations.test.mjs`, `tests/assignment-language.test.mjs` | L |
| P3 | Original assignment/source language preserved; presentation language only if clearly labelled; legacy unknown | `server/reports.mjs`, `server/exports.mjs` | `tests/assignment-language.test.mjs`, `tests/reports.test.mjs`, `tests/exports.test.mjs` | L (presentation language not exported) |
| P4 | Formula-neutralized CSV, private authorized downloads, expiry/purge | `server/reports.mjs`, `server/exports.mjs`, `src/export-recovery.ts` | `tests/reports.test.mjs`, `tests/exports.test.mjs`, `tests/export-recovery.test.mjs` | L |
| P5 | Draft edits do not mutate sent versions; corrections create traced versions; withdrawal/archival preserve evidence | `server/domain.mjs`, `server/publication-history.mjs`, `server/publication-receipts.mjs` | `tests/draft-flow.test.mjs`, `tests/publication-history.test.mjs`, `tests/briefing-archive.test.mjs` | L |
| P6 | Secondary templates, glossary, scheduling, invoices, audit, privacy settings and account/site selection retain contracts | `server/templates.mjs`, `server/glossary.mjs`, `server/schedules.mjs`, `server/billing.mjs`, `server/audit.mjs`, `server/retention.mjs`, `server/sites.mjs` | `tests/templates.test.mjs`, `tests/glossary.test.mjs`, `tests/publication-schedules.test.mjs`, `tests/billing.test.mjs`, `tests/audit.test.mjs`, `tests/retention.test.mjs`, `tests/sites.test.mjs` | L |
| P7 | Privacy deletion/retention covers names, credentials/setup, language requests, presentations/audio, acknowledgments, deliveries, push, exports, backups and local recovery | `server/deletions.mjs`, `server/deletion-redactions.mjs`, `server/text-retention-input.mjs`, `server/domain.mjs`, `server/retention.mjs`, backup modules | `tests/deletion-redactions.test.mjs`, `tests/deletion-state.test.mjs`, `tests/text-retention.test.mjs`, `tests/retention.test.mjs`, `tests/notification-events.test.mjs` | L |
| P8 | Application cleanup is not claimed as provider-history, backup or device erasure | `server/deletion-completions.mjs`, `src/deletion-state.ts` | `tests/deletion-state.test.mjs` | L |

## 9. Schema, permissions, backup and restore

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| D1 | Additive transactional migrations with recovery; supported adapters; unsupported features gated explicitly | `server/postgres/migrations/*` (108), `server/postgres/migrate.mjs`, SQLite schema modules | `tests/postgres-embedded.test.mjs`, `tests/postgres-import.test.mjs`, schema-upgrade tests; native fresh database open | L (PGlite), O (native) |
| D2 | Required concepts: verified signup, entitlement/activation ledger, worker names/credentials/site membership, 15 locales, language requests, presentations, frozen Send modes/audience, per-recipient deliveries, acknowledgments, push outbox | Migrations 099-108 and prior schema modules | Full suite schema/permission tests | L |
| D3 | Validated contracts, bounded payloads, stable IDs, relational integrity, atomic audit, expected revisions; no caller-supplied scope | Input modules and schema triggers | `tests/*-input` coverage inside feature suites; `tests/audit.test.mjs`, `tests/session-http.test.mjs` | L |
| D4 | Runtime permission profiles match new tables; operator has no private/AI/mail handles or raw content; startup verifies schema/grants without runtime DDL | `server/postgres/runtime-permissions.mjs`, `server/postgres/operator-permissions.mjs`, `server/postgres/identity-permissions.mjs` | `tests/runtime-permissions.test.mjs`, `tests/operator-permissions.test.mjs`, `tests/operator-service.test.mjs` | L (policy-level; native grants O) |
| D5 | Synthetic import/export preserves identities/history but quarantines sessions, setup/reset/verification tokens, push endpoints/deliveries and reconciles privacy state | `server/postgres/import-sqlite.mjs`, `server/postgres/backup.mjs` | `tests/postgres-import.test.mjs`, `tests/invitation-backup.test.mjs`, `tests/restore-*.test.mjs` | L |
| D6 | Encrypted/native backup/restore retains evidence without reviving tokens or erased content | `server/postgres/backup-native.mjs`, `server/backup-files.mjs` | `tests/backup-restore.test.mjs`, `tests/postgres-backup.test.mjs`; native backup test skipped | L (embedded), O (native) |
| D7 | Historical data without names/language/modes stays honestly Unknown/Legacy; demo workspaces not silently commercialized or deleted | Migration defaults, `server/db.mjs` schema upgrade | `tests/assignment-language.test.mjs`, `tests/postgres-import.test.mjs` | L |

## 10. Visual, accessibility and device acceptance

| ID | Agreed requirement | Implementation | Current evidence | Status |
|---|---|---|---|---|
| A1 | Understood identity, calm visual character, phone-first worker and responsive supervisor; proper Arabic staff and worker script layouts | `src/styles.css`, components | `artifacts/phase7/worker-ar-320.png`, `worker-en-1440.png`, `staff-notifications-1440.png`, `staff-notifications-320-fixed.png` | L (selected screens) |
| A2 | Keyboard/focus, labelled controls/errors, reduced motion, contrast, live status, zoom/reflow, narrow/short screens, long translations, mixed IDs, dialogs, touch | Components and CSS | Phase 7 exact 320px RTL, 3px focus outlines, Enter activation, reduced-motion emulation; earlier accessibility sweep `artifacts/a11y-2026-10-22/results.json` | L (browser emulation) |
| A3 | Microphone permission, interruption, playback and touch acceptance on real devices | Worker recorder components | Synthetic/browser only | E |
| A4 | Screen-reader/NVDA and independent accessibility acceptance | — | No AT session | E |
| A5 | Independent native-language review of every locale/script | — | No reviewer evidence | E |

## 11. Production, infrastructure and release gates

| ID | Requirement | Current state | Status |
|---|---|---|---|
| X1 | Native PostgreSQL migration, roles, TLS, concurrency and proxy contract | Native PostgreSQL 16.15 fresh migration 1/1, concurrency 2/2 and local certificate verification pass; native runtime-role execution, proxy handling and production-major parity are open. See G4. | O |
| X2 | Native current-schema backup/restore and quarantine | Native PostgreSQL 16.15 encrypted `pg_dump`/`pg_restore`, isolated readback and quarantine pass; off-site/production-major evidence remains G15/G16. See G5. | L |
| X3 | Separate explicit production admission that fails closed without approved configuration | `server/postgres/production-admission.mjs` and `scripts/production-admission-check.mjs` reject staging/demo/synthetic/fixture shortcuts, require an exact candidate/approval manifest, and keep the live-adapter registry empty; production startup remains hard-blocked (`tests/production-admission.test.mjs` 6/6). See G6. | L |
| X4 | Approved real-data provider and privacy policy for all required stages/languages | Synthetic-only adapters; no real-data approval. See G7. | E |
| X5 | Verified email domain and controlled-inbox delivery | No verified domain or real send. See G8. | E |
| X6 | Real web push and physical-device acceptance | No external push/device. See G9. | E |
| X7 | Independent security review | Local checks only. See G10. | E |
| X8 | Independent accessibility/AT and native-language review | Browser emulation only. See G11. | E |
| X9 | Approved compute, DNS, public TLS and trusted proxy | No host/DNS/certificate. See G12. | E |
| X10 | Measured capacity, load, soak and free-tier quota exhaustion | No load/quota run. See G13. | O |
| X11 | Deployed monitoring, heartbeat and observed incident drill | Local health surfaces only. See G14. | O |
| X12 | Off-site encrypted backup, key custody and observed restore drill | No independent destination/drill. See G15. | E |
| X13 | Combined staging end-to-end over HTTPS with approved synthetic data | Local loopback only. See G16. | E |
| X14 | Frozen release candidate and written deployment authorization | Dirty tree; decision NO-GO. See G0/G18. | E |

## Findings from this reconciliation

1. **Read-only presentation behavior is implemented, not missing.** Cached and snapshot
   presentations remain readable while new generation returns `deferred`
   (`generation_paused`). The earlier language-readiness note that described this as open was
   stale and has been corrected.
2. **Partial delivery for unsupported recipient languages is implemented.** Readiness is
   evaluated per recipient/mode; unsupported recipients stay undelivered with explicit
   reasons while ready recipients release once (`server/delivery-readiness.mjs`).
3. **Reports/exports do not expose presentation language, by design.** They preserve the
   captured assignment language and do not present translated-view metadata as report
   evidence. An optional, clearly labelled presentation-language column remains future work,
   not a release claim.
4. **Repeat-answer and case-review workflows are PostgreSQL-only.** The SQLite detail DTO
   returns `canRequestRepeat:false` and `canReview:false`, so the built demo hides those
   controls rather than silently offering a dead action. Production uses PostgreSQL, where
   both are implemented and tested. SQLite parity is not claimed; `FEATURE_REGISTER.md` A13
   records this limitation.
5. **Supervisor scope is whole-site, not per-crew.** The contract permits either explicit
   per-crew grants or an explicitly assigned whole-site scope. This implementation is
   site-scoped and is recorded as such; there is no per-crew staff grant model.
6. **No locally verifiable contract defect was found in this pass.** The production
   admission review is now implemented and negative-tested, and native PostgreSQL 16.15
   migration, concurrency, local TLS-certificate and encrypted backup/restore checks pass on
   a disposable cluster. The remaining blockers are production-major/Neon PostgreSQL and
   native role execution, plus the external provider, mail, push/device, review, hosting,
   capacity, monitoring, backup and authorization gates. A fabricated manifest still cannot
   make API/worker admission pass because no live provider adapter is registered, and no
   production startup path is wired.

## What this matrix does not prove

- It does not prove a production-major native PostgreSQL run, native runtime grants, public
  TLS, proxy header handling or a hosted database endpoint.
- It does not prove real AI/translation/speech quality in any language, or that all 14
  languages are supported by an approved provider.
- It does not prove real email delivery, web push delivery, notification clicks, physical
  device behavior or assistive-technology acceptance.
- It does not prove capacity, quota behavior, monitoring, disaster recovery or off-site
  backup.
- It does not authorize deployment, real worker data, paid services or public resource
  creation.

Gate statuses and remaining actions are tracked in `PRODUCTION_RELEASE_GATES.md`. The release
decision remains **NO-GO**.
