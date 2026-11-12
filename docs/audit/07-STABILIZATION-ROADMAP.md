# 07 — Stabilization roadmap

This roadmap is ordered by risk. Completed items are marked. Remaining items are independent and testable; no speculative dates.

## Completed in this audit

### T01 — Preserve delivery evidence on SQLite startup (R3-03)
- **Files:** `server/instruction-schema.mjs`.
- **Change:** removed destructive `DROP TABLE instruction_deliveries`; validate exact schema/foreign keys and refuse unknown state.
- **Tests:** `tests/audit-safety-regression.test.mjs`.
- **Acceptance:** populated valid ledger survives repeated startup; invalid schema refuses without deleting rows.
- **Status:** complete.

### T02 — Resolve late-delivered content by exact assignment (R3-01/R3-02)
- **Files:** `server/postgres/delivered-content.mjs`, `server/postgres/presentations.mjs`, `server/postgres/responses.mjs`, `server/postgres/case-repeats.mjs`, `server/postgres/clarifications.mjs`, `server/postgres/notification-events.mjs`, `server/postgres/translation-feedback.mjs`, `server/postgres/recording-worker.mjs`, `server/postgres/provider-budget.mjs`, `server/clarification-view.mjs`, `server/clarifications.mjs`, `server/presentations.mjs`, `server/translation-feedback.mjs`.
- **Change:** publication snapshot wins when present; otherwise use the exact assignment delivery content. Never use a publication-wide or cross-worker fallback.
- **Tests:** `tests/audit-late-delivery-regression.test.mjs`, `tests/audit-recording-late-delivery.test.mjs`.
- **Acceptance:** late language works for presentation, staff evidence, feedback, notification title, check-back, and recorded-answer assessment; original publication remains unchanged.
- **Status:** complete.

### T03 — Add workspace integrity constraints (R3-04)
- **Files:** migration `127_workspace_integrity.sql`, `server/workspace-schema.mjs`, `server/workspace.mjs`, `server/postgres/workspace.mjs`.
- **Change:** additive ownership/JSON/date/attachment/completion constraints; SQLite guards; migration refuses anomalous retained rows.
- **Tests:** `tests/audit-workspace-integrity.test.mjs`.
- **Acceptance:** invalid direct SQL is rejected; valid draft/upload/send/complete flows still work; migration does not delete or advance on anomalies.
- **Status:** complete.

### T04 — Bound library pagination (R3-05)
- **Files:** `server/workspace.mjs`, `server/postgres/workspace.mjs`.
- **Change:** SQL filtering/counting/status aggregation/paging; only the page is returned; UTC normalization and Unicode-aware SQLite search.
- **Tests:** `tests/audit-workspace-integrity.test.mjs`.
- **Acceptance:** page size bounded; total/counts correct; non-UTC ordering/date filter correct; Unicode search preserved.
- **Status:** complete.

### T05 — Align CSP across hosting paths (R3-06)
- **Files:** `server/content-security-policy.mjs`, `server/public-build.mjs`, `vercel.json`.
- **Change:** one shared policy constant; Vercel header matches Node.
- **Tests:** `tests/audit-safety-regression.test.mjs`.
- **Acceptance:** header values are identical; app/media/service-worker flows still work in local build.
- **Status:** complete.

### T06 — Use latest receipt for improvement analytics (R3-07)
- **Files:** `server/self-healing-input.mjs`, `server/self-healing.mjs`, `server/postgres/self-healing.mjs`, migration `126_improvement_receipt_order.sql`.
- **Change:** latest submission receipt sequence is authoritative; pending new audio excludes older assessed answers.
- **Tests:** `tests/audit-safety-regression.test.mjs`.
- **Acceptance:** tied timestamps/reverse IDs select the latest receipt; pending audio does not reuse an older assessed answer.
- **Status:** complete.

### T07 — Request-owned provider deadlines (R3-08)
- **Files:** `server/ai/nemotron-instruction-delivery.mjs`, `server/postgres/preparation.mjs`.
- **Change:** cached adapter creates request-owned deadlines while sharing a limiter; reserved slots transfer directly to waiters.
- **Tests:** `tests/audit-safety-regression.test.mjs`.
- **Acceptance:** overlapping requests cannot extend each other’s budget; shared pacing remains.
- **Status:** complete.

### T08 — Bound DeepL responses and preserve choice order (R3-09)
- **Files:** `server/ai/deepl-translate.mjs`.
- **Change:** bounded streaming parser, cancellation of oversized bodies, ordered choices when the optional question is absent.
- **Tests:** `tests/audit-safety-regression.test.mjs`.
- **Acceptance:** oversized response is cancelled before parsing; choices map in order.
- **Status:** complete.

## Remaining tasks

### T09 — Decide pilot duration (R3-10)
- **Decision:** 14 days (current code) vs 30 days (prior audit documentation).
- **Files if changed:** `server/pilot-policy.mjs`, operator activation bounds, non-protected staff copy, tests.
- **Risk:** existing trials/paid grants; customer communication.
- **Acceptance:** one documented contract, independent tests, no retroactive date rewrite without a migration decision.
- **Status:** awaiting product decision.

### T10 — Decide production translation policy (R3-11)
- **Decision:** current Gemini routing vs DeepL-primary with reviewed fallback.
- **Files if changed:** `server/ai/production-gemini.mjs`, `server/postgres/production-admission.mjs`, provider policy/provenance, env examples, tests.
- **Risk:** every generated artifact, real-data admission, language coverage, cost.
- **Acceptance:** explicit primary/fallback policy, no silent substitution, unsupported locale block, approval fingerprint.
- **Status:** awaiting product/provider decision.

### T11 — Resolve launch locale scope (R3-12)
- **Decision:** all 15 locales vs a reviewed subset with explicit fallback.
- **Dependencies:** T10, current provider capability evidence, native-language review.
- **Acceptance:** stage × locale matrix; unsupported locales blocked or explicitly covered; no silent scope reduction.
- **Status:** external/blocked.

### T12 — Dependency upgrade (R3-16)
- **Files:** `package.json`, `package-lock.json`, `vite.config.ts`.
- **Blocker:** protected dev server on port 3020 holds the native Rolldown module; `npm ci` cannot replace it without stopping that server.
- **Mitigation applied:** Reticle is disabled outside `serve`; build/typecheck pass.
- **Acceptance:** clean locked install, advisory scan, build/typecheck, browser smoke; no forced incompatible major overrides.
- **Status:** partially mitigated; upgrade deferred.

### T13 — Native PostgreSQL and recovery acceptance
- **Scope:** native roles/TLS/concurrency, pg_dump/pg_restore, isolated restore, quarantine, off-site DR.
- **Acceptance:** exact candidate, native service, evidence; no PGlite substitution.
- **Status:** external/blocked.

### T14 — Live provider, email, push, and device acceptance
- **Scope:** approved real-data provider, verified email domain, VAPID push, physical microphones/phones, shared-device behavior.
- **Acceptance:** actual evidence; no synthetic fallback; privacy approval.
- **Status:** external/blocked.

### T15 — Independent security, privacy, accessibility, and native-language review
- **Scope:** qualified review, AT testing, native-speaker review of all enabled locales.
- **Acceptance:** findings reconciled; no certification claim from automated scans.
- **Status:** external/blocked.

### T16 — Observability, load, and incident readiness
- **Scope:** deployed monitoring/alerting, load/soak/SLO, incident drill, rollback.
- **Acceptance:** measured evidence and runbook.
- **Status:** external/blocked.

### T17 — Billing product decision (R3-14)
- **Decision:** keep manual invoices or add an authorized payment/subscription integration.
- **Acceptance:** if added, signed webhooks, idempotency, failed-payment handling, entitlement consistency, sandbox evidence.
- **Status:** product decision.

### T18 — Minor send-result title (R3-13)
- **Files:** `src/SendInstruction.tsx` or route title helper.
- **Acceptance:** result page title matches the visible result; reset restores the composer title.
- **Status:** open P3.

### T19 — Test-suite quality (R3-19)
- **Scope:** reduce implementation-coupled source-scanning tests; add negative/concurrency/migration/recovery cases; keep browser fixtures.
- **Acceptance:** behavior-focused coverage for critical paths; no weakening of existing checks.
- **Status:** ongoing.

## Recommended order

1. T09/T10/T11 product/provider decisions (they gate launch scope).
2. T12 dependency upgrade when the protected dev server can be stopped.
3. T13/T14/T15/T16 external acceptance.
4. T17 billing decision.
5. T18/T19 minor/quality work.
