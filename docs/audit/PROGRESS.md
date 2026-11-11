# Understood stabilization audit progress

Baseline: commit `270788d`, branch `feat/complete-crew-workflows`, 2026-11-11.

## Scope and boundary

Execute discovery, source review and safe synthetic verification, and produce the ten requested audit reports. Do not change application code, settings, services, or databases. Fixes require review and approval of the roadmap. No deployment, outbound notifications, paid AI calls, or real-worker data processing.

Confirmed launch intent: controlled real-worker pilot; 30 days from operator activation; one site; 25 active workers; pending and expired workspaces read-only; DeepL primary translation with reviewed fallback for gaps; all advertised worker locales required. Text-model selection remains open.

## Current phase

Audit-only scope completed: ten reports, 53 feature groups, 11 findings plus one acceptance gap, six product decisions and 13 roadmap tasks. Full test suite completed against an isolated tracked-source snapshot with clean locked dependencies and external-service environment variables removed. External acceptance remains blocked/unverified as listed below.

## Completed evidence

- Clean working tree recorded before audit; candidate snapshot created outside checkout.
- Node 24.20.0 / npm 11.19.0; clean dependency installation passed (165 packages).
- Candidate build/typecheck passed; large chunks and ineffective dynamic imports remain warnings.
- npm production dependency advisory check returned zero reported vulnerabilities; this is not a security certification.
- Docker daemon unavailable; psql/pg_dump/pg_restore not found on PATH. Native database and recovery checks currently blocked.
- Source-confirmed pilot duration mismatch: policy constant 14 versus required/documented 30 days.
- Production live pipeline admits Gemini adapters; DeepL currently exists on the synthetic inline text path. Required production translation routing needs review.
- Inventoried 53 feature groups; reviewed cross-module rules, roles, storage, jobs, provider paths, deployment and recovery boundaries. Reports 01–07 and 09 are drafted with evidence limits.
- Reproduced late-delivery presentation/check-back and staff evidence failures (A-03/A-04), request deadline sharing (A-05), SQLite repair data loss (A-06), and invalid workspace metadata acceptance (A-07).
- Recorded unbounded library queries (A-08), CSP hosting parity gap (A-09) and all-language acceptance gap (A-10).
- Reproduced improvement analytics selecting an older equal-timestamp answer instead of the newer authoritative receipt (A-11); added its feature group and targeted roadmap task.
- Mocked-provider contract evaluation passed 43/43 contract checks; semantic subset 34/34 with zero disagreements; no live provider call.
- Isolated scripted-provider/PGlite pipeline rehearsal passed 11 named checks; native authentication/cloud storage/pilot acceptance explicitly not evaluated.
- Separate local synthetic evaluation exited 1: 24/34 semantic cases completed, 10 unsupported/not run, 5 disagreements. Limited fixture evaluator, not a live-model result; retained without hiding failure.
- Full suite finished exit 0: 1,770 tests, 1,766 passed, 0 failed, four native tests skipped; 37m 29.5s.
- All-dependency audit exited 1: eight high-severity affected development/build packages; A-12/T12 added. Production-only audit remains zero. No exploit established or dependency changed.
- Evidence scripts, full TAP, summaries and SHA-256 manifest retained under `docs/audit/evidence/`.

## Remaining

- User review of findings and roadmap; no application changes until approval.
- After approved fixes, repeat affected checks and complete native/external acceptance on the exact release candidate.

## Decisions and blockers

- Product decisions D-01–D-06: HR mapping, answer mode, supervisor scope, unmanaged tenants, retained language presentations, manual renewals.
- Native PostgreSQL/roles/TLS/concurrency and dump/restore blocked by unavailable daemon/tools/test URLs.
- Live provider/privacy/all-language acceptance, real email/push, physical-device and independent security/accessibility/load/recovery evidence not executed.
- Final audited-candidate verdict: NOT READY due to confirmed high-priority defects and unmet launch requirements. No approval to fix or release is inferred.

## Fixes

None. Application code and configuration remain unchanged.

## Authorized stabilization continuation

The user subsequently authorized “fix all”. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for current implementation status and evidence. The original ten reports describe the baseline, not an assertion that later code changes were already audited or released. Eleven code findings have local corrections; final full regression is running. Live/external gates and product ambiguities retain their stated limits. No deployment, live migration or real-data provider dispatch was performed.

## Stabilization completion update

- All 11 code findings corrected locally; no known failures remain after affected reruns. See IMPLEMENTATION.md for exact limits.
- Full run: 1,783 total, 1,777 passed, 2 expectation failures, 4 native skips; both failed files corrected/rerun successfully (1 and 25 passing checks).
- Post-run workspace UTC/Unicode regressions reproduced and fixed; final affected workspace/backup group 18 passed.
- Build/typecheck and zero-advisory scan pass; final source manifest and evidence retained.
- Native image retrieval blocked; no test DB/container created; task-started Docker Desktop stopped after empty-container inventory.
- A-10/external acceptance and D-01–D-06 remain open. No deployment, commit, push or live data action performed.
