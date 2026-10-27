# Generated Case Follow-Ups

Migration 059 adds a PostgreSQL durable follow-up queue and private audio journal.
This is a synthetic local credential-rehearsal capability, not an enabled real-data
or hosted production pipeline. The local SQLite app queues a checked Gemini
translation for every worker language the follow-up adapter lists, then stores
that translation as the message. When that adapter also lists the language for
speech, the checked text is stored as a private WAV and the conversation can play
it. A speech failure leaves the follow-up undelivered. Gemini Free
must never receive real worker content.

## Delivery

An owner/supervisor submits English text with one UUID. The server freezes case,
assignment, publication, assignment language, actor/role, source digest and company
terminology. Exact actor/command replay returns its current receipt, including
after case closure; conflicting text/scope or reuse by a plain message is denied.
POST requires the current page session context; reads are scoped and no-store.

The separate worker leases requests and rechecks active authority, operational
controls, open case, current publication, deletion status and terminology before
and after provider operations. Non-English output gets an independent translation
check before speech. Speech uses the exact checked target text. Checks do not
certify language correctness or worker understanding.

Canonical WAV bytes are privately staged with durable ownership before storage.
An uncertain conditional save is reconciled by exact readback. Only the final
reauthorized transaction inserts the translated message, attaches audio and marks
delivery with audit. Unknown database acceptance never triggers destructive
compensation. Crash attempts have bounded leases; abandoned staging has cleanup.
Original attempts, assessments, notes and submission receipts are not rewritten.

Worker/staff audio reads verify integrity and reauthorize after private-object
reads. No object key, signed public link, English generation source, glossary,
provider prompt or private case notes enter the worker DTO. Resolved threads keep
history but cannot receive new messages. Audio follows configured site retention.
Deletion blocks playback immediately, waits for leased writes and durable object
cleanup, then redacts source/manifest/conversation. Completion separately verifies
private objects are absent, rather than trusting cleanup flags alone.

## Configuration

`UNDERSTOOD_CASE_FOLLOWUP_ADAPTER=disabled` is the default. The isolated PostgreSQL
local credential rehearsal can explicitly select `gemini` with
`UNDERSTOOD_DATA_CLASS=synthetic` and a server-side `GEMINI_API_KEY`. Both persisted
global and tenant provider quotas must be enabled before dispatch. Requests reserve
one slot for English speech or three for translation/check/speech, and journal
each network attempt with renewed authority checks. No live call was made here.
`npm run dev` turns local follow-ups on in demo mode when `GEMINI_API_KEY` is set.
`npm run dev:credential-test` does the same in credential mode with the synthetic
data class. It is for test text only: the conversation shows supervisors that
follow-ups go to the free Gemini tier. Plain `npm run dev` in credential mode keeps
follow-ups off.
SQLite follow-ups attach speech when the adapter lists the language and returns a valid WAV. Text is still delivered when the adapter has no speech method. PostgreSQL delivery still requires the adapter to list the language for speech.
Hosted configuration continues to reject free-tier provider activation.

The conversation has explicit generate/send, receipt check, pending/failure and
private playback controls. Recovery persists only UUID/hash/command kind under
the exact session/case, never plaintext. There is no automatic mutation retry.
The Follow-up inbox view independently counts published assignments with an open
case and delivered staff message, including already-answered assignments. It is
not an unread counter. Staff notifications use metadata-only message events.

## Evidence And Limits

2026-10-10: focused conversation/inbox/generation checks: 30 passed, zero failed
or skipped (11.419 seconds). Subsequent queue/quota/privacy/migration/import/hosted
runtime checks: 37 passed, zero failed or skipped (15.597 seconds). These overlap;
do not sum them into a unique-test count. The latter includes three mocked Gemini
requests, closed/exhausted quotas, source/manifest redaction and false-completion
prevention. Strict build passes; entry 525.60 kB/141.67 kB gzip still warns.

Built disposable PGlite browser flow verified an uncertain queue acknowledgement,
failed receipt read, metadata-only reload recovery, Arabic worker conversation,
private two-second tone playback (readyState 4, error null, advancing time) and
Follow-up (1) inbox selection. Tone playback is not actual synthesized speech or
language QA. Disposable worker signed out, tab closed, fixture 5744 stopped.
Screenshot inspected inline; no saved screenshot/mobile/full reference proof.
Reticle has no connected session and issued no verdict. An optional feedback
report was rejected by auto-review as an external project-detail transmission;
no workaround or report transmission followed. Yield recorded locally.

Main synthetic/email-disabled preview refreshed as 39521 on 3020/3021. Seven
selected business/settings hashes are unchanged, messages remain zero, integrity
is ok and foreign-key errors zero. No cloud, live provider, mail or real data used.

Still open: supervisor-requested assessed repeat attempts/rebrief, voice replies,
explicit disagreement, editable deadlines, SQLite generated-delivery parity,
privacy-approved live processing, real Neon/R2/TLS/proxy/concurrency/deployment
and final release/reference/accessibility/performance verification. S15/S24/A13
remain partial. No new audited overall percentage or production-readiness claim.
