# 01 — Project overview

Audit date: 2026-11-11. Source baseline: `270788d` on `feat/complete-crew-workflows`. This is an independent source/test audit, not a release approval. Application code was not changed.

## Product and value

Understood helps companies issue instructions to multilingual frontline workers, check comprehension, and manage follow-up. A company contains sites, staff, crews and workers. A supervisor composes an instruction using text, recorded source audio, or attachments, selects recipients and delivery/response modes, then sends. Preparation, translation and speech can run asynchronously. Each worker receives a scoped assignment with frozen publication evidence. Workers acknowledge receipt or answer a question; incorrect/unassessable answers and help requests create follow-up cases. Understanding and actual work completion are separate states.

Likely customers include employers with multilingual operational teams, consistent with the Gulf-focused requirements in the conversation. Industry, jurisdictional compliance and translation accuracy are not established by source code.

## Authoritative audit requirements

- Controlled pilot with real workers, not public unrestricted go-live.
- 30 days from operator-approved activation; one site; 25 active workers; pending/expired workspace read-only; manual paid activation.
- Staff interface English/Arabic; all 15 worker locale codes (14 languages, Punjabi in two scripts).
- DeepL primary translation, separately reviewed fallback only for gaps. Text/assessment model remains a product/provider decision.
- Preserve published instructions, answers, recordings, receipts and audit history except authorized retention/deletion.

Older requirements describe a 14-day trial and free-form typed/voice answers; recent code also uses multiple-choice questions. These must not be silently conflated. See unresolved decisions in report 03.

## Roles implemented

| Principal | Actual boundaries inspected |
|---|---|
| Owner | Site operational actions, workforce management, staff access, billing records, settings; last active site owner protected |
| Supervisor | Site instruction/workforce/case operations; not owner-only billing or staff-role administration |
| Administrator | Staff account/access management; frontend routes toward staff settings; not a generic operational superuser |
| Auditor | Selected reports/read models and staff/settings views; instruction/workforce writes rejected; translation-feedback submission is explicitly allowed, while operator triage is not |
| Worker | Own assignments, answers, help/messages, language request, device and notification access; crew roster exposes a limited projection |
| Platform operator | Separate operational identity/service and database profile for tenant controls, entitlements, provider policies and support observations |

There is no `hr` role in `server/staff-input.mjs`. Earlier HR workforce-only requirements require an explicit mapping decision. Supervisor permissions are generally scoped to a site, not an individual assigned crew.

## Stack and entry points

| Layer | Implementation |
|---|---|
| UI | React 19.3 / TypeScript 7 / Vite 8; hash routes; `src/main.tsx`, feature components, shared request/recovery helpers and localized dictionaries |
| API | Node 24 native HTTP; `server/index.mjs` SQLite local implementation; `server/postgres/http.mjs` PostgreSQL implementation; shared route/input helpers |
| Database | Raw SQL, no ORM identified; built-in Node SQLite and `pg`; PGlite for embedded PostgreSQL tests; 124 numbered SQL migration files, latest 125 |
| Authentication | Application-owned password credentials and opaque hashed session tokens; scrypt; invitation/recovery flows; Neon OTP or Resend proves registration email possession |
| Jobs | SQL-backed queues, leases, receipts, retries, worker heartbeat; `server/worker.mjs` and `server/postgres/runtime.mjs` |
| Storage | Local private audio or S3-compatible Neon/R2 adapters; generated speech, source/answer/case recordings; instruction attachments stored as scoped base64 database rows |
| AI | Synthetic fixtures, synthetic provider rehearsal adapters, demo inline NVIDIA/DeepL or Cloudflare path, separately admitted production Gemini pipeline |
| Mail / push | Resend; optional pilot Gmail via nodemailer; web-push/VAPID with in-app event/read models |
| Billing | Manual USD invoices/payments/voids plus independent operator entitlement changes; no automatic processor/webhook lifecycle established |
| Hosting | Vercel gateway and static build; separate hosted API/worker/operator launchers; Neon integration files. Actual live configuration not inspected or changed |
| Tests / CI | Node test runner; 316 top-level test files; TypeScript/build checks; four CI test shards with PostgreSQL 18 service and separate synthetic evaluations |

Package versions above come from `package.json`; dependency presence does not establish end-to-end service availability.

## Data and control flow

1. Email proof → company/site/owner credentials → pending entitlement and activation request.
2. Operator approval → entitlement revision/transition → first-run setup → operational writes.
3. Composition/audience capture → briefing preparation job → published immutable snapshot + recipient delivery ledger → assignments.
4. Worker response receipt → typed/audio processing → attempt assessment → case when follow-up is needed.
5. Case message/repeat/review/resolution → worker eligibility to continue → explicit work completion.
6. Audit/event creation → in-app projection and optional push deliveries; provider acceptance is not handset receipt.
7. Retention/deletion jobs → redaction/tombstones/private-object cleanup; backups/restore quarantine preserve access and privacy restrictions.

## Repository navigation

- `src/`: UI, localized copy, recording/offline/session recovery, staff and worker feature components.
- `server/`: SQLite repositories, shared validation/schema/contracts, audio/storage, job processing.
- `server/postgres/`: parallel PostgreSQL repositories, migrations, runtime permissions, operator/provider admission, backup controls.
- `server/ai/`: adapters, structured validation, capability/provenance checks, provider pacing and bounded transports.
- `api/gateway.mjs`, `vercel.json`: serverless routing and hosted configuration.
- `scripts/`: local/hosted entry points, fixtures, evaluation, migration/backup/admission utilities.
- `tests/`, `.github/workflows/verify.yml`: verification and CI configuration.
- `docs/`: extensive historical decisions/evidence. Historical hashes and test counts do not certify this candidate.

## Development status and review boundary

Clean source baseline was archived into a disposable temporary directory; locked install and build passed there. The audit reads current source and tests, not the old localhost preview. No cloud database, real worker record, live email/push recipient or paid AI endpoint was used.

The product has substantial real implementations and negative tests, not merely placeholders. It also contains confirmed cross-module defects and a production-provider mismatch. Presence of a feature, a mock test or a deployment file is not proof of real-worker readiness. Module-level assessment and exclusions follow in reports 02–10.
