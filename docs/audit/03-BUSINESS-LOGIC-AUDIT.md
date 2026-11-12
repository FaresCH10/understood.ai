# 03 — Business logic audit

## Canonical state model

### Instruction/draft

`draft → processing → ready → failed` (repairable). A published version is a separate immutable `publication`; the briefing returns to `draft` for the next version. `next_version` increments only on publication. A draft edit increments `revision` and invalidates dependent preparation/review/glossary readiness.

### Instruction send/delivery

`preparing → published | failed`. Each recipient has a delivery row: `preparing → available | blocked | failed | withdrawn`. A send is idempotent by `request_id`; a retry is idempotent by its own request ID and is bounded to three attempts. Publication freezes the exact snapshot and creates assignments only for recipients whose language/mode is ready.

### Assignment/attempt

`assigned → opened/acknowledged → answer received → assessment pending → matched | clarification | unassessable`. A submission receipt is monotonic per assignment. A duplicate submission ID is one response; a deliberate repeat is a separate attempt. Work completion is a separate `assignment_completions` row and never rewrites the answer outcome.

### Clarification/case

`open → resolved`. A case can be assigned to an owner, escalated, repeated/check-back, reviewed, and resolved with a note. Messages are append-only. A resolved case is immutable except for authorized deletion redaction. A repeat requires an earlier answer and a future deadline; a check-back uses the exact delivered question.

### Schedule/publication

`queued → published | failed | cancelled`. Scheduled publication rechecks authority, revision, content hash, and recipient language at execution. A schedule is not a publication until it executes.

### Entitlement/pilot

`pending → active → read_only/expired` (current implementation uses a 14-day pilot constant and a 25-worker cap). Read-only workspaces can read protected history but cannot create/send/mutate. The prior audit documentation describes a 30-day pilot; this is an unresolved product decision, not silently changed.

### Retention/deletion

Policy → request → purge/redaction/pseudonymization → completion evidence. Deletion is scoped and audited; restore quarantine is separate. Application cleanup does not prove provider/backup/device erasure.

## Confirmed contradictions and fixes

| ID | Contradiction | Impact | Resolution |
|---|---|---|---|
| R3-01 | Publication snapshot was treated as the only localized source even when a later delivery recorded a different language. Presentation, staff response detail, case detail, translation feedback, notification title, and check-back could show the wrong language or fail. | A worker who received a late language could not use it; staff evidence did not match what the worker saw. | Added `server/postgres/delivered-content.mjs` and used it in presentation, response, case, feedback, notification, and check-back readers. Regression: `tests/audit-late-delivery-regression.test.mjs`. |
| R3-02 | Recorded-answer processing used the snapshot question, not the delivered question. | A late-language recording could be assessed against the wrong question. | Recording worker and provider-budget authority now resolve the exact assignment delivery. Regression: `tests/audit-recording-late-delivery.test.mjs`. |
| R3-03 | SQLite startup could drop a populated `instruction_deliveries` table when it saw a composite worker key. | Irreversible delivery-history loss on affected local/legacy databases. | Removed destructive repair; unknown/invalid schema now refuses startup and preserves rows. Regression: `tests/audit-safety-regression.test.mjs`. |
| R3-04 | Workspace tables accepted invalid ownership, JSON, dates, negative attachment sizes, and invalid base64. | Orphan/cross-context data if application validation is bypassed. | Additive PostgreSQL constraints (migration 127) and SQLite guards; migration refuses anomalous retained rows. Regression: `tests/audit-workspace-integrity.test.mjs`. |
| R3-05 | Library pagination loaded all site briefings/assignments and filtered/sorted in JS. | Cost grows with full history; memory/latency risk. | SQL filtering/counting/status aggregation/paging; only the page is returned. Regression: `tests/audit-workspace-integrity.test.mjs`. |
| R3-06 | Vercel static headers omitted the CSP used by the Node static server. | Reduced defense in depth on one hosting path. | Shared `server/content-security-policy.mjs`; Vercel header added. Regression: `tests/audit-safety-regression.test.mjs`. |
| R3-07 | Improvement analytics selected the latest answer by timestamp/random ID instead of the latest submission receipt. | Wrong current match/clarification counts and improvement suggestions. | Latest receipt sequence is authoritative; pending new audio excludes older assessed answers. Migration 126 + regression. |
| R3-08 | A cached inline provider adapter shared one request deadline across overlapping requests. | One request could extend another’s budget. | Request-owned adapters with a shared limiter. Regression: `tests/audit-safety-regression.test.mjs`. |
| R3-09 | DeepL response parsing was unbounded and optional-question choice ordering could shift. | Oversized response retention or wrong choice mapping. | Bounded streaming parser, cancellation, and ordered-choice handling. Regression: `tests/audit-safety-regression.test.mjs`. |
| R3-10 | The current pilot constant is 14 days; prior audit documentation describes 30 days. | Operators and customers may be told different trial windows. | **Unresolved product decision.** Current 14-day contract preserved; no silent change. |
| R3-11 | Current production admission routes preparation/follow-up through Gemini; prior audit documentation describes DeepL-primary translation. | Production provider policy and language coverage are ambiguous. | **Unresolved provider-policy decision.** Current fail-closed Gemini routing preserved; no silent change. |
| R3-12 | 15 worker locales are advertised, but current DeepL capability coverage excludes Sinhala and Shahmukhi Punjabi. | All-locale launch cannot be claimed. | **External acceptance gap.** Documented; no silent scope reduction. |
| R3-13 | Send-result page document title remains “New instruction · Understood” while the heading says “Instruction sent.” | Minor orientation mismatch. | **Open P3.** Not changed in this audit. |
| R3-14 | Manual invoices/payments exist; automated subscription/payment collection does not. | “SaaS billing” is not a complete automated billing system. | **Product decision.** Documented; no payment integration invented. |
| R3-15 | Staff UI supports English/Arabic; Urdu falls back to English. | Urdu staff users see an English workspace. | Documented; Arabic sweep passed; no native-speaker claim. |
| R3-16 | Dependency advisories remain in the Vite/Reticle development/build chain. | Supply-chain/build-workstation risk. | **Partially mitigated.** Reticle is disabled outside `serve`; package upgrade deferred because the protected dev server on port 3020 holds the native Rolldown module. |

## End-to-end journeys checked

- Supervisor: create text instruction, choose members/crew, review, send, inspect delivery/partial delivery, update a sent instruction, view responses, follow up, request another answer, resolve, inspect reports/calendar.
- Worker: sign in, choose language, read/listen, answer typed/voice, acknowledge, request help, read/reply to follow-up, receive repeat, mark work complete, request language change, shared-device/offline paths.
- Cross-role: owner/supervisor/administrator/auditor/worker boundaries; cross-tenant/cross-site denial tests; SQLite/PostgreSQL parity for changed behavior.
- Failure paths: invalid files, network interruption, duplicate requests, expired sessions, revoked grants, suspended/read-only workspace, stale revisions, malformed provider output.

## Business decisions still required

1. Pilot duration: 14 days (current code) vs 30 days (prior audit documentation).
2. Production translation policy: current Gemini routing vs DeepL-primary with reviewed fallback.
3. Launch locale scope: all 15 locales vs a reviewed subset with explicit fallback.
4. Automated billing/subscription: out of scope or a future product track.
5. Staff Urdu: keep English fallback or add a reviewed Urdu staff locale.
6. Whether the send-result document title should be corrected (minor).
