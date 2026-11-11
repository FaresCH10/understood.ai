# 10 — Final audit report

> Subsequent authorized stabilization: all 11 code findings have local corrections. See [delivery record](IMPLEMENTATION.md) for current changes, exact full-run/rerun accounting and remaining release gates. This report below records the original audit baseline.

Baseline `270788d`; branch `feat/complete-crew-workflows`; 2026-11-11. **Audit reports and local verification complete.** Source review and the stabilization roadmap are complete at module level; external acceptance is explicitly incomplete.

## Executive assessment

**NOT READY for the stated real-worker pilot.** Understood has substantial functioning architecture and extensive tests, but known defects prevent reliable language/follow-up behavior, a SQLite compatibility path can discard delivery records, and current production provider routing does not satisfy the agreed DeepL requirement. The pilot duration also contradicts the documented 30-day policy.

No application fixes were made. Only audit documentation and synthetic reproduction evidence were added. No production data, deployed service, paid provider, real mail/push recipient, live access policy or existing preview was changed.

## Product and architecture

The product sends multilingual workplace instructions, records acknowledgement/comprehension, routes help or incorrect/unassessable answers into supervisor follow-up, and tracks actual work completion separately. Companies contain sites, staff, crews and workers. Application-owned password/session access, scoped repositories, immutable publications/receipts and SQL-backed workers support the core flow.

React/TypeScript/Vite supplies the UI. Node native HTTP has SQLite and PostgreSQL implementations, plus shared workspace logic. PostgreSQL includes migrations, runtime roles, leases, provider journals and operator admission. Private file/audio storage, email, push, retention and backup/restore implementations are present. Their existence does not certify a live deployment or provider language quality.

## Findings and implementation status

- **53 feature groups** inventoried with access, expected/implemented behavior, dependencies, validation, states, edges and coverage pointers.
- **11 confirmed findings**, A-01–A-09, A-11 and A-12: five P1 and six P2. A-01/A-02 are requirement mismatches; A-03/A-04/A-05/A-06/A-07/A-11 have disposable reproductions; A-08/A-09 have source/configuration evidence with live impact not measured. A-12 is a dependency advisory finding; exploit applicability is not established.
- **1 additional P1 release acceptance gap**, A-10: all required language/stage/device quality not established. This is not a claim every locale is broken.
- **No P0 exploit confirmed.** No exhaustive-security guarantee follows from that.
- **6 unresolved product decisions**, D-01–D-06; not silently treated as defects or chosen for the user.
- **0 bugs fixed; 0 application regression tests added.** Two observation/reproduction scripts were added as audit evidence. Fixes await roadmap approval.

Highest-priority issues:

1. A-06: a valid populated SQLite delivery ledger loses its row during schema repair.
2. A-03/A-04: late-delivered language exists in immutable delivery content but fails presentation/check-back and loses localized staff evidence.
3. A-02: production admission currently uses Gemini routing; required live DeepL-primary/approved-fallback policy is absent.
4. A-01: pilot policy/grant validation uses 14 days despite approved/documented 30 days.

Other findings concern database workspace constraints, shared inline request deadlines, unbounded library queries, hosting CSP differences and inconsistent latest-answer ordering in improvement analytics. The main root causes are parallel-engine drift, inconsistent content authority, runtime-family/provider divergence, destructive compatibility heuristics, and tests that import the policy constant they should independently verify.

## Security and data integrity

Positive controls include hashed opaque sessions, scrypt, principal/tenant revalidation, parameterized queries, scoped private objects, upload limits/scanning, immutable receipts, operator separation, provider approval/budgets, leases, privacy redaction and restore quarantine. Those controls need to remain intact during stabilization.

The audit did not establish a cross-tenant HTTP exploit. Workspace table constraint weaknesses are direct-database integrity findings; unmanaged entitlement behavior is an explicit policy uncertainty. Native role/TLS/concurrency, independent security/privacy/accessibility and deployed configuration remain unverified.

## Verification

Clean locked install and build/typecheck passed in an isolated tracked-source snapshot. Production dependency advisory check reported zero known vulnerabilities. The all-dependency scan failed with eight high-severity affected packages in the Vite/Reticle development/build chain (A-12); this is not eight independently demonstrated exploits or evidence of runtime compromise. A limited redacted secret-pattern scan selected 1,934 text files from 2,824 tracked files with no candidates; it does not certify Git history or credential revocation.

Mocked-provider contract evaluation passed 43/43 contract checks; semantic subset 34/34 completed with zero disagreements against injected engineering labels, not an independent model-quality test. Scripted-provider/PGlite pipeline rehearsal passed 11 named checks. The separate local synthetic assessment evaluation **failed (exit 1)**: 24 of 34 semantic cases completed, 10 unsupported/not run, 5 outcome disagreements. That limited fixture assessor does not certify live comprehension. Reproductions demonstrate the six reproduced issue IDs without live data or paid calls.

**Full suite: 1,770 tests; 1,766 passed, 0 failed, 4 skipped, exit 0, in 37m 29.5s.** Local command uses concurrency 2 and a 15-minute test timeout, unlike the default npm/CI configuration. See report 08 for the final run, skips, failures and limitations. Native PostgreSQL and native backup/restore are not certified by embedded tests.

No new browser/device/assistive-technology or independent penetration testing was executed. Real email/push, live provider language acceptance, load/SLO, alerts and off-site recovery drills remain outside the evidence available here.

## Decisions requiring review

1. Define workforce-only HR permission mapping; current administrator role is not that role.
2. Confirm multiple-choice versus earlier typed/voice free-form answer behavior.
3. Confirm site-wide versus crew-assigned supervisor authority.
4. Decide whether legacy unmanaged organizations need explicit real-data approval or fail-closed entitlement.
5. Define all-content language changes in terms of retained presentation artifacts, including follow-up/history limits.
6. Confirm manual renewal/reconciliation responsibility; automatic payment processing remains deferred.

## Recommended next action

Review [the issue register](06-BUG-REGISTER.md) and [the stabilization roadmap](07-STABILIZATION-ROADMAP.md), containing 13 independent tasks with dependencies, acceptance criteria and regression risks. T00 protects delivery history; T01 corrects trial policy; T03 repairs late-language readers; T05 isolates inline request budgets. These can be staged independently after authorization. Provider work needs additional explicit stage/privacy/capability decisions.

Reassess the exact fixed candidate only after required regression, native infrastructure, all-language/device, operational and independent acceptance evidence is collected. No deployment or real-data activation is authorized by this audit.

## Report index

1. [Project overview](01-PROJECT-OVERVIEW.md)
2. [Feature inventory](02-FEATURE-AUDIT.md)
3. [Business logic](03-BUSINESS-LOGIC-AUDIT.md)
4. [Technical/database/API](04-TECHNICAL-AUDIT.md)
5. [Security/privacy/reliability](05-SECURITY-RELIABILITY-AUDIT.md)
6. [Issue register](06-BUG-REGISTER.md)
7. [Stabilization roadmap](07-STABILIZATION-ROADMAP.md)
8. [Test report](08-TEST-REPORT.md)
9. [Readiness verdict](09-PRODUCTION-READINESS.md)
10. [Progress tracker](PROGRESS.md) and [evidence](evidence/README.md)
