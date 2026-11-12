# 01 — Project overview

Audit date: 2026-11-12. Candidate: `main` at `bd3e1ec` plus the local audit fixes described in `06-BUG-REGISTER.md`. This document describes the repository as inspected, not a deployment approval.

## Product

Understood is a multi-tenant supervisor-to-worker instruction SaaS for frontline teams. A supervisor writes, records, or uploads a short instruction. The system prepares a translated version, a practical check question, and a private answer rubric. Workers receive text and/or voice in their approved language, acknowledge receipt or answer, and supervisors follow up on unclear or incorrect answers. Workers separately mark the actual work complete.

The product deliberately separates:

1. instruction preparation;
2. delivery;
3. receipt acknowledgment;
4. answer submission;
5. answer assessment;
6. follow-up/clarification;
7. actual work completion.

A delivered instruction is not proof of reading. Acknowledgment is not understanding. A matching answer is not certification of understanding or safe work. A matching answer is not work completion. Opening an instruction does not complete work.

## Users and roles

- **Owner** — full site access, staff/site administration, billing records, privacy/retention.
- **Supervisor** — creates/sends instructions, reviews responses, handles clarifications.
- **Administrator** — staff/site settings within assigned scope; not a content approver.
- **Auditor** — read-only access to permitted records; cannot mutate or play worker recordings.
- **Worker** — restricted principal; sees only own assignments, content, answers, and follow-up.
- **Platform operator** — separate service/origin for tenant operations, provider controls, jobs, and support. Not a customer role.

## Core workflows

- **Create/send:** content → recipients → review/send. Preparation is automatic; the supervisor does not operate provider jobs.
- **Update:** content → recipients → review/send. The previously sent version remains visible until a new version is sent; version history is immutable.
- **Worker response:** read/listen → acknowledge or answer (typed/voice) → assessment → matched/clarification/unassessable → optional help/follow-up → separate work completion.
- **Follow-up:** clarification queue → case detail → conversation/voice follow-up → repeat/check-back → review/resolve.
- **Administration:** sites, crews, workers, CSV import, staff invitations/roles, language requests, templates, glossary, usage, manual invoices, retention/deletion.
- **Operations:** tenant controls, provider policy/verification, job retry, audit, support access.

## Stack

- **Client:** React 19, TypeScript, Vite 8, hash routing in `src/main.tsx`, PWA/service worker, customer and operator shells.
- **Server:** Node 24 native HTTP, no web framework. Shared domain modules in `server/*.mjs`.
- **Local/demo database:** SQLite via `node:sqlite`; schema is created/upgraded in code by `ensure*Schema` modules.
- **Hosted database:** PostgreSQL with 127 SQL migrations in `server/postgres/migrations/`; PGlite is used for embedded tests.
- **Jobs:** DB-backed jobs/leases for preparation, assessment, presentations, exports, reminders, schedules, retention, deletion, source audio, push, and provider verification.
- **Storage:** local private audio for demo; R2 or Neon object storage for hosted; private reads are server-mediated.
- **Auth:** custom credential auth; scrypt password hashes; opaque hashed session cookies; one-use worker grants; worker passwords with credential revisions; account memberships for multi-site staff.
- **Deployment:** Vercel gateway (`api/gateway.mjs`) with Neon Postgres or an ephemeral in-memory demo; Docker/hosted API, worker, and operator services; Caddy configs.
- **Tests:** `node:test`; 1,782 tests in the last full run, including SQLite, PGlite, HTTP, browser fixtures, and source/contract checks.

## Repository map

- `src/` — React UI, route shell, worker/staff surfaces, localization, recovery, PWA/offline, client contracts.
- `server/` — shared domain, SQLite runtime, HTTP handlers, auth, jobs, AI adapters, storage, retention, notifications.
- `server/postgres/` — PostgreSQL repositories, migrations, runtime roles, hosted/operator services, backup/restore.
- `tests/` — unit, integration, PGlite, HTTP, browser-fixture, migration, and contract tests.
- `scripts/` — dev/hosted launchers, fixtures, evaluation, deployment/preflight, backup.
- `docs/` — product/operations documentation. This audit adds `docs/audit/`.
- `api/gateway.mjs` — Vercel entry point.
- `vercel.json`, `Dockerfile`, `compose*.yaml`, `deploy/` — deployment configuration.

## Runtime entry points

- Local dev: `scripts/dev.mjs` starts `server/index.mjs` (SQLite API), `server/worker.mjs`, and Vite.
- Hosted: `scripts/postgres-hosted.mjs` starts the PostgreSQL API, worker, or operator service.
- Vercel: `api/gateway.mjs` selects `server/vercel-neon.mjs` when a database/live mode is configured, otherwise `server/vercel-demo.mjs` (ephemeral in-memory SQLite).
- Operator: `operator.html` + `src/operator-entry.tsx`; separate origin/service and credentials.

## Architecture observations

1. **Two database engines.** SQLite and PostgreSQL implement the same workflows separately. Shared modules reduce duplication, but route sets, validation, ordering, and failure behavior can drift. This is the largest systemic maintenance risk.
2. **Content authority is split.** A publication snapshot, per-assignment delivery content, and presentation artifacts can each hold localized content. The audit fixed the known late-delivery readers, but every new reader must choose the correct authority deliberately.
3. **Derived state is duplicated.** Instruction/work/report/worker status is computed in SQL, server JS, and frontend dictionaries. The audit found and fixed specific contradictions; the pattern remains a regression risk.
4. **Idempotency is per module.** Request receipts, leases, retries, and lost-commit handling are implemented separately for sends, publications, assessments, recordings, exports, imports, and retention. There is no single cross-domain contract.
5. **Provider policy is split.** Synthetic fixtures, inline Nemotron/DeepL, and production Gemini+DeepL have different admission and capability rules. The current production path is fail-closed; the prior audit's DeepL-primary recommendation is not applied because it is a provider-policy decision.
6. **Localization is duplicated.** Worker UI has 15 locales; staff UI is English/Arabic (Urdu falls back to English). Large inline dictionaries make missing-key drift likely.
7. **Test suite is large but uneven.** Many tests are strong domain/DB/HTTP checks; some are source-scanning or layout guards. A passing suite is not proof of live provider quality, physical-device behavior, or production readiness.

## Evidence boundary

- The last full suite on the pre-audit source passed 1,782 tests (1,778 passed, 0 failed, 4 skipped). The audit re-ran focused suites and a fresh full suite after the fixes; see `08-TEST-REPORT.md`.
- No production deployment, real worker data, real email/push, paid provider call, native PostgreSQL service, or physical device was used.
- The external `.ui-audit/` reports and screenshots are historical evidence. They are not copied into the product repository and are not treated as current proof.
- The untracked `.verify-live/` directory contains local verification scripts and a `secret.txt`; it was not read, printed, or committed.
