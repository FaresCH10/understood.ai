# 08 — Verification report

> Subsequent authorized stabilization: all 11 code findings have local corrections. See [delivery record](IMPLEMENTATION.md) for current changes, exact full-run/rerun accounting and remaining release gates. This report below records the original audit baseline.

Baseline `270788d`; 2026-11-11. **Completed: 1,770 tests; 1,766 passed, 0 failed, 4 skipped, 0 cancelled. Exit 0; 37 minutes 29.5 seconds.**

## Isolation and reproducibility

The clean tracked candidate was archived and extracted to `C:\Users\Hussein\AppData\Local\Temp\understood-audit-20261111-270788d`. `npm ci --no-audit --no-fund` installed the lockfile there. Node 24.20.0 / npm 11.19.0 on Windows. Application-specific/provider/database environment variables were removed from the child check processes. No current `.env`, user database, cloud connection, paid provider transport or existing preview was used.

Full-run command:

```text
node --test --test-timeout=900000 --test-concurrency=2 --test-reporter=tap tests/*.test.mjs
```

This is the full 316-file top-level test selection, with lower concurrency and a 15-minute test timeout for this local machine. It is **not** the exact `npm test` default (five-minute timeout) or the Linux CI shard configuration. This local pass does not prove those other configurations passed. Native tests that require explicit database URLs remain skipped.

## Executed checks

| Check | Result | Evidence/limit |
|---|---|---|
| Clean locked install | Passed | 165 packages; isolated copy |
| TypeScript and production build | Passed, exit 0 | `evidence/build-output.txt`; large chunks and ineffective dynamic imports remain warnings |
| Production dependency advisory scan | Passed, zero reported vulnerabilities | `evidence/dependencies.json`; not application-security certification |
| Tracked secret-pattern scan | No candidates for selected patterns | 1,934 selected text files / 2,824 tracked files; no history/untracked/entropy guarantee |
| Mocked provider contract evaluation | Passed, exit 0 | 43/43 contract checks; semantic subset 34 completed, 0 failures/disagreements; no live provider |
| Local synthetic assessment evaluation | Failed, exit 1 | 34 semantic cases: 24 completed, 10 unsupported/not run, 5 outcome disagreements; `evidence/local-evaluation-summary.json`. This fixture-only adapter is not the live model |
| Isolated pipeline rehearsal | Passed, exit 0 | 11 named journey checks; scripted provider/PGlite/memory storage; no native/cloud/pilot claim |
| Additional SQLite/deadline/unmanaged-entitlement observations | Executed | Reproduced A-05/A-06 and current D-04 behavior; script exit 0 means observations completed, not invariants passed |
| Additional PGlite late-delivery/schema observations | Executed | Reproduced A-03/A-04/A-07; no live data |
| Full suite | Passed, exit 0; 1,766 passed / 0 failed / 4 skipped | `evidence/full-suite.tap` and `evidence/full-suite-summary.json`; 1,770 total, 37m 29.5s |
| All-dependency advisory scan | Failed, exit 1; 8 high-severity affected packages | `evidence/all-dependencies.json`, dependency tree; development/build chain, A-12; exploit applicability not established |

The mocked contract report's aggregate raw metrics include intentionally rejected malformed-output fixtures. The command gates on contract checks, and `semanticMetrics` separately records the semantic subset. The mock supplies engineering-labelled expected answers: its zero disagreements establish contract handling, **not independent model accuracy**. Do not describe all raw report cases as live semantic successes.

The local synthetic evaluator intentionally supports only one shelf rubric; tests already document unsupported alternative rubrics. Its CLI still exits 1 for the measured gaps/disagreements, which is reported as failed rather than suppressed. This does not establish that a live provider has the same accuracy failures. It establishes that the local fixture assessor cannot certify general comprehension.

## Reproduced invariants that fail

- A-06: valid populated SQLite delivery ledger: 1 row before repair, 0 after.
- A-05: original 25-second inline request budget still permits mock translation after 26 seconds when another request resets the deadline.
- A-03: late Hindi delivery count increases to 2, ledger has content, but presentation reports unavailable; Hindi → Urdu preference also unavailable; check-back throws despite prior accepted answer/help case.
- A-04: staff detail question null/English choices versus actual delivered Hindi content.
- A-07: migrated PGlite schema accepts invalid direct workspace metadata and nonexistent ownership references.
- A-11: improvement shared query selects an older clarification while receipt-authoritative ordering selects the newer matched answer at the same timestamp.

These are application defects/risks despite the existing suite passing. The audit added observation scripts, **not** changes to the application's committed regression suite.

## Blocked / not executed

- Native PostgreSQL 18 concurrency, native authentication/least-privilege/TLS and native dump/restore: Docker daemon unavailable; `psql`, `pg_dump`, `pg_restore` not on PATH; no explicit disposable test/restore URLs supplied. CI configuration defines PostgreSQL 18 but a checked-in workflow is not evidence its current run passed.
- Real email verification, invitation/recovery delivery and browser/phone push to consenting devices: not executed.
- Paid/live AI, DeepL account capability queries, real-worker data and independent native-language review: not executed.
- New browser end-to-end/physical microphone/camera/playback/device acceptance, manual all-locale UI, accessibility/assistive technology and independent penetration test: not executed.
- Realistic load/SLO, monitoring/alert drill, off-site backup/key custody/RPO/RTO, production migration/rollback and actual cloud-header tests: not executed.
- No lint script is declared in the inspected package; no invented lint result.

## Required follow-up

The full TAP, extracted summary and SHA-256 artifact manifest are retained under evidence. The four skips are native dump/restore with private object readback, native public authentication/mixed mail concurrency, native concurrent grant/publication/receipt/assessment, and native migration scope/immutable-publication enforcement. These skips mean those requirements remain unverified, not passed. The roadmap requires new regression assertions and affected-suite reruns after each approved fix. The final release candidate must also pass supported CI/native and external acceptance gates; no release approval follows from this local report.
