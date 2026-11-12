# 10 — Final audit report

## Executive summary

Understood is a substantial, working multi-tenant instruction SaaS with a broad feature set and a large test suite. The current `main` at `bd3e1ec` did **not** contain the fixes from the prior external audit branch. This audit re-verified the clear code/data-integrity findings, applied them to `main`, added focused regressions, and re-ran the stabilization browser checks.

The product is **not production-ready**. The remaining blockers are unresolved product decisions (pilot duration, provider policy, locale scope, billing), unverified native/live/device/security/accessibility evidence, and missing operational readiness. The local/synthetic product is materially more stable, but that is a different claim from production readiness.

## Product architecture

- React 19 + TypeScript + Vite SPA; Node 24 native HTTP backend.
- SQLite for local/demo; PostgreSQL with 127 migrations for hosted; PGlite for embedded tests.
- Shared domain modules plus separate SQLite/PostgreSQL repositories.
- DB-backed jobs/leases; private local/R2/Neon storage; custom credential auth; separate operator service.
- Vercel gateway, Docker/hosted API/worker/operator, Caddy configs.

## Features audited

26 feature groups were inventoried: public/registration/recovery, staff auth/session, Today, composer, update workspace, preparation/providers, publication/schedule/withdraw/archive, worker inbox/detail/playback, typed/voice answers, acknowledgment/photo evidence, assessment, clarifications/case chat/repeat/review, work completion, reports/exports/calendar, people/crews/import/language requests, settings/staff/invitations, billing/usage/entitlements, privacy/retention/deletion, notifications/push, operator console, PWA/offline/shared device, localization/accessibility, jobs/leases, and security/tenant isolation.

## Confirmed defects and fixes

| ID | Defect | Status |
|---|---|---|
| R3-01 | Late-delivered language not used by presentation, staff evidence, case detail, feedback, notification title, or check-back. | Fixed; regression-tested. |
| R3-02 | Recorded-answer processing used the snapshot question for late-delivered languages. | Fixed; regression-tested. |
| R3-03 | SQLite startup could drop a populated delivery ledger. | Fixed; regression-tested. |
| R3-04 | Workspace tables accepted invalid ownership/JSON/date/attachment metadata. | Fixed with additive constraints/guards. |
| R3-05 | Library pagination materialized all site history. | Fixed with SQL paging. |
| R3-06 | Vercel omitted the Node CSP. | Fixed with shared policy. |
| R3-07 | Improvement analytics used non-authoritative latest-answer ordering. | Fixed with receipt ordering. |
| R3-08 | Shared inline provider deadline could be extended by another request. | Fixed with request-owned adapters. |
| R3-09 | DeepL response parsing was unbounded; optional-question choices could shift. | Fixed. |

## Business-logic inconsistencies

- Late-delivery content authority was the main cross-module contradiction; fixed for the known readers and recorded-answer path.
- Pilot duration is 14 days in code but 30 days in prior audit documentation; unresolved.
- Production translation is Gemini-routed in code but DeepL-primary in prior audit documentation; unresolved.
- 15 locales are advertised but current DeepL coverage excludes Sinhala and Shahmukhi Punjabi; external/blocked.
- Manual invoices exist; automated subscription/payment collection does not; product decision.
- Staff Urdu falls back to English; documented, no native review.
- Send-result document title remains “New instruction · Understood” while the heading says “Instruction sent”; open P3.

## Security and data integrity

- No P0 cross-tenant exploit or data-corruption path was confirmed in the reviewed scope.
- Fixed: destructive SQLite repair, late-delivery content authority, recorded-answer late delivery, workspace integrity, CSP parity, bounded library.
- Residual: dual-engine drift, per-module idempotency, dependency advisories, unverified native roles/TLS, no independent security review.

## Tests added

- `tests/audit-late-delivery-regression.test.mjs`
- `tests/audit-recording-late-delivery.test.mjs`
- `tests/audit-workspace-integrity.test.mjs`
- `tests/audit-safety-regression.test.mjs`
- Migration inventory updates for 126–128.
- Existing stabilization tests (`postgres-calendar`, `stabilization-ui`, `draft-flow`, `artifact-review`, `worker-submission-receipt`) remain.

## Tests passed and failed

- Focused audit regressions: 12 passed (1 + 1 + 3 + 7).
- Migration inventory group: 35 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Browser fixtures: staff stabilization, round 2, update flow, Help, worker wrong/work, Arabic sweep — all passed.
- Full suite: **1,794 tests, 1,790 passed, 0 failed, 4 skipped, 0 cancelled, exit 0, 2,154,714.9932 ms (35m 54.7s)**. Log: `.verify-live/full-suite-audit.log`.
- Not executed: native PostgreSQL, live providers, real email/push, physical devices, independent security/privacy/accessibility/native-language review, load/SLO/DR.

## Remaining unresolved issues

- R3-10 pilot duration decision.
- R3-11 production translation policy decision.
- R3-12 all-locale acceptance.
- R3-13 send-result title.
- R3-14 automated billing decision.
- R3-15 staff Urdu fallback.
- R3-16 dependency upgrade (blocked by protected dev server on port 3020).
- R3-17 dual-engine drift.
- R3-18 remaining content-authority readers.
- R3-19 test-suite quality.
- R3-20 observability/DR/load.

## Recommended next actions

1. Decide pilot duration, provider policy, locale scope, and billing.
2. Freeze a candidate and run a clean full suite.
3. Upgrade Vite/Reticle when the protected dev server can be stopped; re-run advisory/build checks.
4. Run native PostgreSQL roles/TLS/concurrency and backup/restore.
5. Obtain approved real-data provider/privacy configuration and run live language/quality acceptance.
6. Run real email/push/device and independent security/privacy/accessibility/native-language review.
7. Add deployed monitoring/alerting, load/SLO, DR, rollback, and incident drills.
8. Correct the send-result title and continue reducing dual-engine drift.

## Production readiness verdict

**NOT READY.** The local/synthetic product is stable enough for continued controlled verification, but production launch and real-worker onboarding require the decisions and external evidence above.
