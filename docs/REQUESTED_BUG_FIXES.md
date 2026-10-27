# Requested fixes — 26 October 2026

Application changes are implemented and verified below. Live service activation is still limited by the inspected configuration and Gemini quotas; this is not an all-services-ready release claim.

## Application changes

1. **Email verification:** the existing verification, resend, one-use token, expiry and activation paths pass SQLite and PostgreSQL regression checks. The development launcher now loads `.env` for both API and worker and preserves the chosen access mode. Real delivered mail is not verified.
2. **Company-assigned credentials:** Team assigns the worker ID and password. Passwords are hashed; resetting revokes prior sessions, setup codes and access links. Opening an invitation requires company ID, worker ID, password and its matching one-use token. Legacy public self-set-password routes return HTTP 410. Internal historical setup helpers remain for maintenance compatibility.
3. **Voice instructions:** Send exposes the existing recorder/upload/transcription/review/publish path. Title is required before upload. A synthetic browser microphone stream produced a playable 18.1-second preview. Recorded-source preparation now creates multiple-choice questions on both backends. Real recordings still depend on the configured transcription adapter.
4. **Periodic refresh:** background session and inbox checks retain the current screen and input nodes. A browser draft retained its title, body, focus and node identity after 73 seconds, with no inert state or document navigation.
5. **Required title:** Send and recorded-source creation require an explicit title. No title is derived silently from the instruction body; the API validates length as well.
6. **Link expiry:** credentials do not extend invitation lifetime. Expiry is checked at redemption and session lookup, including the exact boundary and after successful redemption.
7. **Multiple-choice checks:** new sends and recorded-source instructions use four localized options with a frozen private answer key. Generated questions remain grounded in the instruction. Choice IDs are validated on the server; correct choices record a match, and incorrect choices create a supervisor clarification/notification. Existing publications keep their historical answer format. Workers never receive the answer key. Receipts and supervisor responses display the selected option text.
8. **Languages:** generation selection, translation validation, stored speech references, processing history, artifact inspection/editing/regeneration, worker histories, exact receipts and offline choice snapshots support all 15 locale codes. The normal PostgreSQL Send flow now uses configured generation and private-audio verification instead of rejecting generated bundles or claiming their jobs with the demo processor. Readiness becomes ready only after validating published artifacts and reading back both private speech tracks. Missing/corrupt audio cannot publish. Language readiness is removed from AI processing actions. The local SQLite demo retains its existing synthetic fixtures; provider-backed generation uses the PostgreSQL credential runtime.
9. **Notifications and language approval:** both headers show scoped unread counters. Confirmed read actions refresh the counter. Device language settings create a request; approved server session language controls the interface. A local browser preference cannot override it. A Hindi request from an Urdu worker remained pending while the interface stayed Urdu.

## Configuration and live checks

The inspected `.env` contains a Gemini key, but no email mode, Resend key, verified sender, mail encryption key, credential access mode or provider adapter selections. No secret values were printed or changed. A key alone does not activate disabled services.

Email delivery requires the private settings `UNDERSTOOD_EMAIL_MODE`, `UNDERSTOOD_RESEND_KEY`, `UNDERSTOOD_EMAIL_FROM` and `UNDERSTOOD_AUTH_MAIL_KEY`. Worker password flows require credential access mode. Existing synthetic-data/provider allowlists and production admission rules remain in force.

A bounded live Gemini check used only a fixed synthetic walkway instruction. Translation/completeness checks passed for all 15 locales. Both speech tracks passed technical WAV checks for English, Arabic, Hindi, Urdu and Bengali. Further speech requests returned HTTP 429; the other ten locales are not claimed as live-verified. Text and speech requests now use separate pacing, and one rejected generated translation can be repaired and rechecked within the existing 64-operation limit. No failed bundle is marked ready. Native-speaker accuracy and listening review remain separate from artifact integrity.

PostgreSQL migration `109_generation_language_locales.sql` expands generation selections. Startup refuses stale migration ledgers. Upgrade tests preserve existing selections. The SQLite upgrade preserves rows, foreign keys, indexes and immutable-history triggers.

## Verification

- Final TypeScript/build checks pass. Existing bundle-size and dynamic-import warnings remain.
- Focused regressions cover auth, company assignment, invitation recovery/expiry, email verification, source audio, language approval, notifications, generated audio, multiple-choice grading, migrations and client locale contracts. Tests use SQLite/PGlite and mocked delivery/providers unless explicitly identified above as live.
- A normal generated Send assigned all 15 locales, served private audio and four options, graded 14 correct responses and one incorrect response without a provider guess, and created the supervisor notification.
- Browser checks used disposable in-memory databases. All 15 locales had four choices, two audio controls, working histories and correct direction at a 390px phone viewport with no horizontal overflow. Hindi was also checked separately through actual private audio playback and a selected-answer receipt.
- Invitation entry showed exactly three credential fields, blocked Continue before they were supplied, redeemed with HTTP 200 and opened the correct worker account.
- Reticle previously verified required-title blocking, voice entry and audience loading in the isolated development preview. Its coverage is partial because the app has no subscribed application store.
- No deployment or user database migration was performed. Verification logs/screenshots are under ignored `artifacts/bugfix-*`.
