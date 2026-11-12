# 02 — Feature audit

Status vocabulary: **verified** (reproducible test/evidence), **working with limitations**, **partial**, **broken**, **architecturally problematic**, **unclear**, **not verified**.

| # | Feature group | Roles | Current status | Evidence / notes |
|---|---|---|---|---|
| 1 | Public landing, pricing, walkthrough, pilot/contact | public | Working with limitations; not re-audited visually | Protected by the stabilization brief. No approved legal documents; registration policy access remains blocked (ST-15). |
| 2 | Registration, email verification, account recovery | public/staff | Working with limitations | Credential-mode tests and recovery tests exist. No real email delivery was used. Registration legal links remain blocked. |
| 3 | Staff sign-in, session lock, site switching, sign-out | staff | Verified | Auth/session tests, browser fixtures, session-lock and site-switch checks. |
| 4 | Today / attention queue | owner/supervisor/auditor | Verified | Delivery problems, help/follow-ups, waiting workers, scoped counts, language summary, no “0% of 0”. Browser-verified in the prior stabilization pass. |
| 5 | Instruction composer (create) | owner/supervisor | Verified | Text/record/upload, recipients, review, sticky send, draft save, partial-delivery confirmation, duplicate-send guard. Browser-verified. |
| 6 | Instruction update / draft workspace | owner/supervisor | Verified | Content → Recipients → Review and send; preparation diagnostics collapsed; auto-preparation; sent version retained; version history. Browser-verified. |
| 7 | Preparation/provider pipeline | system | Working with limitations | Synthetic fixtures and provider adapters exist. Production admission is fail-closed. No live provider quality/account acceptance. |
| 8 | Publication, schedule, withdraw, archive, copy | owner/supervisor | Verified | Immutable publication snapshots, schedule/withdraw/archive tests, version history. |
| 9 | Worker inbox, detail, playback, language choice | worker | Verified | Own-assignment scoping, paging, language selection, device speech, content expiry, late-delivery content fallback. |
| 10 | Worker typed answer | worker | Verified | Receipts, attempts, assessment jobs, duplicate submission handling, exact-version rubric. |
| 11 | Worker voice answer | worker | Working with limitations | Recording upload, transcription/assessment worker, late-delivery question fallback. Physical microphone/device acceptance not performed. |
| 12 | Acknowledgment and photo evidence | worker | Verified | Acknowledgment-only mode, photo evidence mutual exclusion, private evidence reads, immutable evidence. |
| 13 | Assessment outcomes | system | Verified | Matched/clarification/unassessable, evidence validation, failed-assessment routing, no silent pass. |
| 14 | Clarifications, case chat, repeat/check-back, review | staff/worker | Verified | Scoped cases, messages, voice, repeat, review, resolution, late-delivery staff evidence and check-back. |
| 15 | Work completion | worker | Verified | Separate from answer outcome; idempotent; requires understanding; appears in history/library. |
| 16 | Reports, exports, calendar | owner/supervisor/auditor | Verified | Response completion vs answer-match semantics, scoped CSV exports, calendar route on both runtimes, no false zero state. |
| 17 | People, crews, CSV import, language requests | owner/supervisor | Verified | Scoped directory, crew membership, import preview/confirm/errors, language request approval. |
| 18 | Workspace/site/staff settings, invitations | owner/admin/auditor | Verified | Site creation/edit language parity, staff roles, invitations, unsaved-settings guard, unknown settings tabs. |
| 19 | Billing, invoices, usage, entitlements | owner/auditor/operator | Working with limitations | Manual invoices/payments/voids and usage/entitlement state exist. No automated subscription/payment collection; this is a product/business decision, not silently implemented. |
| 20 | Privacy, retention, deletion, restore | owner/operator | Working with limitations | Retention policies, deletion redaction/pseudonymization, restore quarantine, audit. Native backup/restore and off-site DR not verified. |
| 21 | Notifications, push, reminders | staff/worker | Working with limitations | In-app notifications and push outbox/adapters exist. No real push/device acceptance. Local fixture’s `/api/notifications/live` 404 is expected. |
| 22 | Operator console | operator | Working with limitations | Separate origin/service, tenant controls, provider policy, jobs, audit, support access. No deployed operator acceptance. |
| 23 | PWA, offline, shared device | worker | Verified with limitations | Offline saved copies, outbox, shared-device cleanup, sign-out warnings. Physical device/background-sync acceptance not performed. |
| 24 | Localization and accessibility | all | Working with limitations | 15 worker locales; EN/AR staff; Arabic sweep passed; native-speaker, AT, and physical-device acceptance not performed. |
| 25 | Jobs, leases, retries, idempotency | system | Working with limitations | DB-backed jobs and leases exist; patterns are per module. Concurrency/replay tests exist for key paths; full process-kill/native concurrency not verified. |
| 26 | Security and tenant isolation | all | Working with limitations | Scoped queries, auth revalidation, CSRF/origin checks, CSP, private storage, operator separation. No independent security review; native role/TLS acceptance not performed. |

## Feature-level findings

- **Late-delivery content authority** was broken in the current `main`: presentation, staff response detail, case detail, translation feedback, notification titles, and check-back could read the immutable snapshot instead of the per-assignment delivered content. Fixed and regression-tested.
- **Recorded-answer late delivery** was also broken: the recording worker and provider-budget authority used the snapshot question. Fixed and regression-tested.
- **SQLite schema repair** could drop a populated delivery ledger. Fixed; the schema now refuses unknown/invalid state and preserves rows.
- **Workspace integrity** allowed invalid ownership/JSON/date/attachment metadata. Fixed with additive PostgreSQL constraints and SQLite guards.
- **Library pagination** materialized all site history in JS. Fixed with SQL filtering/counting/paging and bounded returned rows.
- **CSP parity** was missing on Vercel. Fixed with a shared policy constant and Vercel header.
- **Improvement analytics** used timestamp/random-ID ordering instead of the latest submission receipt. Fixed.
- **Shared inline provider deadline** could be extended by overlapping requests. Fixed with request-owned adapters and a shared limiter.
- **DeepL response handling** lacked a bounded streaming parser and could mis-handle optional questions. Fixed.
- **Dependency advisories** remain: the supported Vite/Reticle upgrade could not be installed because the protected dev server on port 3020 holds the native Rolldown module. The build now disables Reticle outside `serve`; the package upgrade is deferred and documented.

## Not verified

- Live provider model quality, language coverage, and account eligibility.
- Real email, push, SMS/WhatsApp, or payment collection.
- Native PostgreSQL roles/TLS/concurrency and native backup/restore.
- Physical microphones, phones, shared devices, and assistive technology.
- Independent security/privacy/accessibility review.
- Load, soak, SLO, monitoring/alerting, and disaster-recovery drills.
- Native-speaker review of all 15 worker locales and Arabic staff copy.


## Exhaustive UI audit (2026-11-12)

A full route/locale UI sweep was added after the initial feature audit: 37 staff routes at desktop and phone, 20 public routes, 37 Arabic staff routes, 15 worker locales × 4 core worker surfaces, and 10 operator tabs (201 page checks). It found and fixed missing staff/worker route titles, the English-only first-run page under Arabic, a missing landing texture on the Node static server, and untranslated Filipino Help/Device copy. No horizontal overflow, duplicate IDs, missing image alt text, or page/console/HTTP errors remain in the audited surfaces. The one remaining real UI accessibility finding is the protected public footer brand link, which has no accessible name; it was not changed because the landing page is protected. See `11-UI-AUDIT.md` and `evidence/ui-audit/`.
