# Audit progress

Candidate: `main` at `bd3e1ec` plus local audit fixes. Audit date: 2026-11-12.

## Current phase

Fixes applied; full regression suite completed. Final report/readiness verdict recorded.

## Completed

- Repository/status inspection; confirmed `main` at `bd3e1ec`, clean except untracked local verification artifacts.
- Re-derived architecture, roles, workflows, route map, and dual-engine structure.
- Re-verified the prior external audit findings against the current `main`; confirmed the prior fixes were not present on `main`.
- Applied and tested the clear code/data-integrity fixes:
  - late-delivery content authority (presentation, staff evidence, case detail, feedback, notification title, check-back);
  - recorded-answer late-delivery question;
  - destructive SQLite delivery-ledger repair;
  - workspace integrity constraints;
  - bounded library pagination;
  - CSP parity;
  - latest-receipt improvement ordering;
  - request-owned provider deadlines;
  - bounded DeepL responses/ordered choices.
- Added migrations 126–128 and focused regression tests.
- Preserved current pilot/provider policy decisions rather than silently changing them.
- Ran focused tests: late delivery, recorded late delivery, workspace integrity, safety regressions, migration inventories, typecheck, build.
- Re-ran the stabilization browser scripts (staff, round 2) on the final build.

## Remaining

- Full suite recorded: 1,794 tests, 1,790 passed, 0 failed, 4 skipped, exit 0.
- `08-TEST-REPORT.md`, `09-PRODUCTION-READINESS.md`, `10-FINAL-REPORT.md` written.
- Commit the audit fixes and docs (if authorized).
- External acceptance: native PostgreSQL/roles/TLS/backup/restore, live providers, real email/push, physical devices, independent security/privacy/accessibility/native-language review, load/SLO/monitoring/DR.

## Issues discovered

- R3-01 late-delivery content authority (fixed).
- R3-02 recorded-answer late delivery (fixed).
- R3-03 destructive SQLite repair (fixed).
- R3-04 workspace integrity (fixed).
- R3-05 unbounded library (fixed).
- R3-06 CSP parity (fixed).
- R3-07 improvement ordering (fixed).
- R3-08 shared provider deadline (fixed).
- R3-09 DeepL bounds/choices (fixed).
- R3-10 pilot duration 14 vs 30 (decision).
- R3-11 production translation policy (decision).
- R3-12 all-locale acceptance (external).
- R3-13 send-result title (open P3).
- R3-14 automated billing absent (product decision).
- R3-15 staff Urdu fallback (documented).
- R3-16 dependency advisories (partial; upgrade blocked by protected dev server).
- R3-17 dual-engine drift (partial).
- R3-18 remaining content-authority readers (partial).
- R3-19 test-suite quality (ongoing).
- R3-20 observability/DR/load (external).

## Tests executed

- `node --test tests/audit-late-delivery-regression.test.mjs` — 1 passed.
- `node --test tests/audit-recording-late-delivery.test.mjs` — 1 passed.
- `node --test tests/audit-workspace-integrity.test.mjs` — 3 passed.
- `node --test tests/audit-safety-regression.test.mjs` — 7 passed.
- Migration inventory group — 35 passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `node .verify-live/staff-stabilization-verify.mjs` — exit 0.
- `node .verify-live/stabilization-round2-verify.mjs` — exit 0.
- `npm test` — 1,794 tests, 1,790 passed, 0 failed, 4 skipped, exit 0, 2,154,714.9932 ms (35m 54.7s).

## Blockers and decisions

- Pilot duration: 14 days current vs 30 days prior documentation.
- Production translation: current Gemini routing vs DeepL-primary prior documentation.
- Launch locale scope: 15 advertised vs current DeepL coverage.
- Automated billing: not implemented; product decision.
- Dependency upgrade: protected dev server on port 3020 holds the native Rolldown module.
- Native PostgreSQL, live providers, real email/push, physical devices, independent reviews, load/DR: external.

## Guardrails

No deployment, push, production data change, real email/push, paid provider call, landing/sign-in edit, credential output, or git config change. The untracked `.verify-live/secret.txt` was not read or committed.
