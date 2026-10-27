# Functional audit fixes

This change addresses the 20 findings from the functional audit. Existing published snapshots, answer IDs, assessments, and receipts remain historical evidence.

## Behavior changes

- Voice help, voice replies, privacy exports, generated follow-ups, and conversation recording notices accept all 15 registered worker locales.
- Acknowledgments suppress deadline reminders and overdue alerts.
- Temporary session verification failures pause server actions and hide the workspace while retaining the mounted draft and audio preview. A successful check restores the workspace. Confirmed access loss still locks it.
- New ordinary typed drafts use multiple-choice questions. Distractors explicitly contradict following the instruction. Existing publications keep their original choices and grading IDs.
- All-worker and crew sends reject an audience containing workers without an assigned language, with an actionable Team message. The audience picker returns up to 5,000 crews instead of silently truncating at 100; exceeding that bound produces an explicit error.
- Applying a template selects Type mode and exposes the filled source. Discarding an active recording still uses the existing confirmation.
- The supervisor's entered title is authoritative during preparation. Generated preparation fingerprints now bind the title as well as the source and other dependencies.
- Arabic source normalization uses the normalized English text to find glossary terms. Fifteen-language preparation, English normalization, one grounding repair, and one translation repair fit within the consistent 68-stage bound; the tested maximum path uses 66 operations.
- Approved-language presentations include translated multiple-choice options with the frozen original option IDs. Older cached presentations can append options once, without rewriting their body or saved answers. Answer translations use the selected option text rather than an opaque option ID. Deletion removes translated options with the rest of the presentation content.
- Presentation language validation accepts the registry and honors the configured translator's capabilities. It does not claim that an unconfigured translator exists.
- Send recovery must be saved and read back before a send begins. Unreadable or corrupt recovery blocks fresh sends rather than discarding the previous request ID.
- Reading an unread notification reloads the current page before paging, preventing skipped items. Each custom recording notice can be removed independently.

## Local recording limit

The SQLite development worker now consumes accepted recordings into an explicit unavailable (`blocked`) state when it has no transcription/assessment adapter. It retains the original recording and permits a typed replacement. This prevents indefinite processing indicators; it does not provide live transcription. Automatic recorded-answer assessment requires the configured PostgreSQL worker and its provider controls.

## Applying the change

Restart the API, worker, and frontend after the change. PostgreSQL installations must apply `server/postgres/migrations/110_presentation_choices_and_preparation_budget.sql` through the existing migration process before starting the new runtime. SQLite adds the presentation column and guards during schema initialization.

If synthetic provider preparation is enabled through exact input allowlists, regenerate the approved fingerprint with the existing fingerprint tool: the title is now part of that fingerprint. Do not reuse an older hash that omitted it. No provider settings or credentials were changed by this fix.

Reprepare and publish a new instruction version to apply new generated titles, options, or distractors to existing content. Old publications and their outcomes are unchanged.

## Verification

Regression coverage includes both in-memory SQLite and PostgreSQL-compatible PGlite, all 15 worker languages, published-choice identity, deletion redaction, audience coverage, acknowledgments, provider authority and operation limits, recording fallback, and client DTO validation. Browser fixtures exercise the real React components for session recovery, storage failure, unread pagination, template application, and translated choices. Provider calls in tests use synthetic fixtures. No live provider request or deployment database migration was performed.
