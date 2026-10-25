# Language readiness

The readiness surface is an evidence view, not a language-approval gate. It reports three separate things for each of the 15 registered worker UI locales:

- worker UI support and text direction;
- complete stored content in the latest scoped publication;
- provider translation and speech evidence.

The worker interface is localized in every selectable locale, including the two explicit Punjabi scripts. That is UI coverage only; native-speaker review of the new translations is still pending. Content translation and instruction/question output remain limited to English, Arabic and Urdu, and speech remains limited to English and Arabic. UI-only locales therefore report translation and speech as `unavailable` rather than implying untested support.

The current local and PostgreSQL rehearsal environments are synthetic-only. Their readiness check intentionally reports provider connection and declared translation states as `not_tested`; it never implies that real worker data may be sent to a free-tier provider. Speech is reported only for the languages the configured adapter declares (English and Arabic); Urdu is content-capable but has no speech support, so Urdu speech is `unavailable` rather than untested.

`GET /api/language-readiness` is available to site-scoped staff. `POST /api/language-readiness/test` accepts an empty JSON object and runs the bounded synthetic evidence check for owner, administrator and supervisor roles. It does not call an external provider or expose credentials.

Site generation defaults are persisted and shown independently for each language. They remain restricted to content-capable languages, so selecting a UI-only locale does not silently promise translated instruction content. Selection is not a provider test or an instruction to hide historical content. The card has no unlabeled overall Ready badge. See `GENERATION_LANGUAGES.md` for capture, regeneration, migration and browser evidence.

Historical translated presentations are now a bounded, cache-first artifact layer for English, Arabic and Urdu. `POST /api/worker/briefings/:assignmentId/presentations` creates at most one artifact per assignment, source message and approved target language; `GET` on the same path only reads stored artifacts and never generates. An instruction presentation can be served directly from an existing publication-language snapshot; a missing translator returns `unavailable` instead of inventing content, a paused tenant returns `deferred`, and a provider failure stays visible as `failed`. Original answers, recordings, assessments and publication snapshots are immutable. The worker sees an explicitly labelled translated view, and generated text never replaces the original recording. Presentation reads do not add assignment, answer or delivery denominators, and privacy deletion, text retention and briefing-content retention redact stored presentation copies.

Read-only entitlement behavior is explicit: cached and publication-snapshot presentations remain readable for authorized workers, while new provider generation is paused with `deferred`/`generation_paused` (`tests/presentations.test.mjs`, both repositories). Partial delivery for unsupported or incompletely prepared recipient languages is implemented: ready recipients are released once, while unsupported recipients remain undelivered with `language_unavailable`/`content_unavailable`/`question_unavailable`/`speech_unavailable` reasons (`server/delivery-readiness.mjs`, `tests/instructions.test.mjs`, `tests/instruction-deliveries.test.mjs`).

Reports and historical exports preserve the captured assignment/source language; presentation-language metadata is not exposed as an unlabelled report column, so a translated view cannot be mistaken for a new assignment, answer or assessment. A separately labelled presentation-language export column is optional future work, not a current claim.

Remaining launch work is external: native-speaker review of the 15 worker UI locales, privacy-approved provider connection tests and independent native-language evaluation evidence. See `docs/FUNCTIONAL_ACCEPTANCE_MATRIX.md` for the requirement-level status and `docs/PRODUCTION_RELEASE_GATES.md` for gate G2.
