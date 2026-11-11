# Stabilization delivery record

Local fixes authorized by the user's “fix all”, following audit baseline `270788ddeaf182adde4b45a2b1a6fae84efc5ba3`. All 11 confirmed code/configuration findings now have local corrections and supporting verification. No commit, push, deployment, saved user-database migration, real mail/push or paid/live AI call was performed.

Final source fingerprint: `8dd57ef8f1066ffe2213c0672be481f798cec5386992381dcae2f33619204377`. This is an evidence fingerprint, not a production approval. Candidate and full-run manifests are retained separately under evidence.

## Delivered corrections

| Finding | Correction | Verification and limits |
|---|---|---|
| A-01 | 30-day pilot contract and English/Arabic/Urdu policy copy; historical dates preserved | Independent hard-coded duration/capacity assertion and operator activation/expiry tests |
| A-02 | Gemini preparation/checks/speech/assessment plus paid/reviewed DeepL translation, including presentations/follow-ups; actual translation-stage model evidence, durable metering and worker-only key | Mock production journeys, quotas, approval expiry, script/choice validation and secret separation pass; no live quality/privacy certification |
| A-03/A-04 | Exact-assignment late-delivery resolver for PostgreSQL presentation, answer choice evidence, staff response/case detail and check-back; feedback and notification readers corrected; corresponding SQLite answer/case readers aligned | Late Hindi delivery, approved language change, localized staff choices/case labels, feedback and repeat regressions; original publication remains unchanged |
| A-05 | Cached adapter creates request-owned deadlines while sharing a limiter; reserved slots transfer directly to waiters | Interleaved mock requests cannot extend another deadline; existing generation/failure/retry tests |
| A-06 | Removed destructive schema repair; valid composite keys/rows survive repeated startup; unknown/invalid schema refuses with preserved records | Complete populated ledger preservation, incomplete-schema refusal and foreign-key checks |
| A-07 | Additive PostgreSQL scope/metadata/caption/completion constraints; SQLite equivalent guards; retained-data preflight refuses anomalies | Both-engine invalid ownership/JSON/date/size/caption tests; migration refusal preserves malformed rows and does not advance migration ledger |
| A-08 | SQL filtering/counting/status aggregation/pagination; only page content returned to JS; late-language filter; UTC timestamp normalization and Unicode-aware SQLite search | Both-engine workspace/history tests, bounded returned rows, non-UTC database session ordering/date filter, Cyrillic case-insensitive search and backup checks; realistic native load/SLO remains unmeasured |
| A-09 | Node shares a CSP constant; Vercel supplies the identical policy | Configuration parity assertion and build; actual deployed headers/device flows still require acceptance |
| A-11 | Latest receipt sequence replaces timestamp/random-ID ordering; pending new audio excludes older assessed answers; SQLite trigger refreshed and PostgreSQL guard replaced additively | Tied-timestamp/pending-audio regression, both-engine improvement journeys and restricted-worker checks |
| A-12 | Supported Vite 8.3.8 / Reticle 3.9.0 updates; Reticle limited to development | Clean lockfile install/build; all-dependency advisory scan exits 0 with zero reported vulnerabilities; 74 built JS assets have no selected Reticle markers |

DeepL responses now have a bounded streaming parser and cancel oversized bodies. Ordered choices are also preserved when the optional question is absent.

## Verification results — exact accounting

Node 24.20.0 / npm 11.19.0, Windows. Clean isolated locked installation: 163 packages. Build including TypeScript: passed. All-dependency advisory scan: zero reported vulnerabilities. Existing large-chunk and ineffective-dynamic-import warnings remain.

Full command:

```text
node --test --test-timeout=900000 --test-concurrency=4 --test-reporter=tap tests/*.test.mjs
```

The complete run executed **1,783 tests: 1,777 passed, 2 failed, 4 skipped, 0 cancelled**, in **33m 5.0s**. The raw command exited 1. The failures were an old explicit migration inventory and an error-expectation assertion that the new completion scope trigger reaches before NOT NULL validation. They were corrected without weakening the denied-operation requirement. Reruns passed:

- Embedded PostgreSQL migration/scope/immutability file: **1 passed, 0 failed**.
- Entire runtime-permissions file: **25 passed, 0 failed**.
- Latest workspace/integrity/pagination/backup group: **18 passed, 0 failed**.
- Provider/budget/DeepL-boundary group: **30 passed, 0 failed**; additional case/presentation group: **13 passed, 0 failed**.

**No known test failures remain after these reruns. This is not a claim that one final full-suite command exited green.** During final review, two new pagination regressions were reproduced and corrected: non-UTC session ordering and SQLite's ASCII-only LOWER behavior. Their failing-before evidence is retained, followed by passing affected-suite runs. After the full run began, only the two workspace implementation files and three test files changed; exact differences are listed in `fixes-candidate.json`. The latest source is rebuilt separately.

The full local timeout/concurrency differ from default `npm test` and Linux CI settings. No GitHub Actions result is claimed. The baseline local synthetic free-form assessment evaluation remains a limited fixture evaluator with documented unsupported rubrics/disagreements; it was not converted into an accuracy certification or silently relabelled passed.

## Database and configuration adoption

New additive migrations: **126** (improvement receipt authority), **127** (workspace integrity), **128** (production DeepL evidence). There are 127 migration files because historical number 117 is absent. Existing migration files/checksums were not rewritten. No saved user database was opened or migrated during this work. Review existing-data diagnostics, back up and apply with the maintenance identity before production; reapply/verify role profiles for the new functions.

Only tracked example configuration files were updated. Gemini and paid `DEEPL_API_KEY` belong only in the worker secret overlay. Actual model IDs, reviewed account capabilities and privacy/release approval are still required. See `docs/PRODUCTION_GEMINI_INTEGRATION.md`; no existing secret/environment file was overwritten.

## Remaining release gates and decisions

**Production verdict remains NOT READY for the full real-worker pilot.** A-10 remains open. The required 14 languages / 15 locale variants were preserved. The current DeepL adapter map/admission excludes `si` and `pa-Arab`; the user explicitly chose to block unsupported scope until a fallback is approved. Supported-only mocked integration is not all-language acceptance. Do not reduce the launch scope or bypass that block silently.

The user confirmed: keep Gemini for the existing nontranslation stages, make DeepL primary, and keep fallback disabled. No live provider/privacy approval or credentials were supplied by that decision.

Native PostgreSQL concurrency/TLS/roles and pg_dump/restore remain unverified. Docker Desktop was started for disposable verification, but the image pull failed on registry DNS and the retry did not finish. It was cancelled; no container, database or listener was created. The all-container inventory was empty before stopping the Docker Desktop instance started for this task. No existing container/service was restarted or removed.

Other open gates: real provider/account language capabilities and independent native review, real controlled email/push and physical devices, independent security/accessibility/privacy, native realistic load/SLO, monitoring/alerts, off-site recovery/RPO/RTO, live header verification, exact-candidate release/rollback approval and deployment.

D-01–D-06 remain explicit product decisions: HR mapping, multiple-choice versus free-form defaults, supervisor site/crew authority, unmanaged legacy tenants, retained-history language semantics and renewal responsibility. Confirmed defect corrections did not silently redesign these policies.

## Evidence

See [full-run and rerun summary](evidence/fixes-full-suite-summary.json), [candidate/delta manifest](evidence/fixes-candidate.json), [latest build](evidence/fixes-latest-build.txt), [advisory scan](evidence/fixes-final-dependencies.json), and [native-check status](evidence/fixes-native-status.json). Intermediate failed/stopped runs are retained for traceability and are not final passing evidence.

Audit artifact packaging preserves raw bytes through `.gitattributes`; captured log whitespace is intentionally retained. This packaging-only update does not change application behavior or test results.
