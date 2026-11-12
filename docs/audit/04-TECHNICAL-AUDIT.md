# 04 — Technical, database, and API audit

## Architecture

- **Modular monolith + worker.** Shared domain modules (`server/*.mjs`) are used by the SQLite runtime (`server/index.mjs`) and the PostgreSQL runtime (`server/postgres/*`). The worker loop is DB-backed; there is no in-memory scheduler.
- **Two repositories.** SQLite and PostgreSQL implement the same workflows separately. Shared modules reduce duplication, but route sets and behavior can drift.
- **Frontend.** React SPA with hash routing, lazy route chunks, a large `src/main.tsx` shell, and many client-side contract validators. The client is not the authority; server checks are required.
- **Deployment.** Vercel gateway, Docker/hosted API/worker/operator, Caddy configs. Production admission is fail-closed.

## Route parity

A literal route comparison found:

- **SQLite-only:** `/api/reports.csv`, `/api/push` (legacy prefix), `/api/ops/` placeholder, `/api/auth/invitations/`.
- **PostgreSQL-only:** `/api/notifications/live`, `/api/usage/requests`, `/api/retention/activity`, `/api/retention/briefings`, `/api/retention/cases`, `/api/retention/generated`, `/api/retention/text`, `/api/instructions/gemma4-test`.

Some differences are intentional (Postgres-only live notifications/retention/usage; SQLite legacy CSV/push). They still require explicit parity decisions and tests. The audit added a PostgreSQL calendar route and tests; the local fixture’s `/api/notifications/live` 404 is expected and tolerated by the client.

## Database

- **PostgreSQL:** 127 migrations. Composite tenant/site foreign keys, immutability triggers, receipt ordering, runtime role profiles, provider journals, retention/deletion evidence.
- **SQLite:** schema created/upgraded in code. It mirrors the core model but has separate triggers and guards.
- **New audit migrations:** 126 (improvement receipt ordering), 127 (workspace integrity), 128 (DeepL production evidence constraint). They are additive; no historical migration was rewritten.
- **Integrity fixes:** workspace ownership/JSON/date/attachment constraints; delivery-ledger preservation; latest-receipt ordering.
- **Remaining risks:** dual-engine drift; some readers still choose snapshot vs delivery content; native PostgreSQL role/TLS/concurrency and backup/restore are not verified in this audit.

## Queries and performance

- The library previously materialized all site briefings/assignments and filtered/sorted in JS. It now filters/counts/aggregates/pages in SQL and returns only the page.
- Hot paths reviewed: library, reports, attention queue, case list, worker inbox, exports, calendar. No load/soak benchmark was run.
- Remaining risk: unbounded history growth, missing production query plans, and no measured SLO.

## Transactions and concurrency

- PostgreSQL uses transactions, row locks, advisory locks, leases, and provider journals. SQLite uses `BEGIN IMMEDIATE` and triggers.
- Key idempotency paths: instruction send, publication, assessment, recording, export, import, retention/deletion.
- The audit fixed a shared inline provider deadline and a destructive SQLite schema repair.
- Remaining risk: per-module idempotency patterns; no single cross-domain contract; native process-kill/concurrency drills not run.

## API contracts

- Request validation is generally explicit and bounded. Error messages are mapped to HTTP statuses in the handlers.
- Client contract validators (`checked*` modules) verify response shapes and session context.
- Remaining risk: route parity and error-mapping differences between SQLite and PostgreSQL; some legacy routes are only on one engine.
- The audit added CSP parity and a PostgreSQL calendar route.

## Frontend/backend consistency

- The client uses server-provided session context, request receipts, and recovery state. It does not trust local tenant/role fields.
- The audit fixed the update flow to reuse the composer’s audience/review contract and moved preparation diagnostics behind a disclosure.
- Remaining risk: large `src/main.tsx`, duplicated localization dictionaries, and status/derived-state logic spread across SQL, server JS, and frontend.

## Test quality

- 1,782 tests in the last full run; 4 native-only skips.
- Strong coverage: domain, PGlite, HTTP, migration, authorization, recovery, retention, browser fixtures.
- Weak spots: source-scanning/layout guards; some tests encode implementation details; native PostgreSQL and live providers are not exercised by the default suite.
- The audit added focused regressions for late delivery, recorded late delivery, workspace integrity, CSP, destructive repair, shared deadlines, improvement ordering, and DeepL bounds.

## Dependency and build

- The supported Vite/Reticle upgrade could not be installed because the protected dev server on port 3020 holds the native Rolldown module. The build now disables Reticle outside `serve`; the package upgrade is deferred.
- `npm run typecheck` and `npm run build` pass with the installed dependency set. Build warnings are pre-existing large-chunk/ineffective-dynamic-import warnings.
