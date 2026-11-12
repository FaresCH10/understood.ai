# 08 — Test report

Candidate: `main` at `bd3e1ec` plus the local audit fixes. Environment: Windows 10 x64, Node 24.20.0, npm 11.19.0, Git Bash. No production data, live provider, real email/push, or physical device was used.

## Focused regression tests

| Command | Result |
|---|---|
| `node --test --test-timeout=300000 tests/audit-late-delivery-regression.test.mjs` | 1 passed — late language works for presentation, staff evidence, feedback, notification title, and check-back. |
| `node --test --test-timeout=300000 tests/audit-recording-late-delivery.test.mjs` | 1 passed — recorded-answer assessment uses the late-delivered question. |
| `node --test --test-timeout=300000 tests/audit-workspace-integrity.test.mjs` | 3 passed — SQLite/PostgreSQL invalid ownership/JSON/date/attachment rejection; bounded library; migration refuses anomalous rows. |
| `node --test --test-timeout=300000 tests/audit-safety-regression.test.mjs` | 7 passed — CSP parity, non-destructive SQLite repair, populated ledger preservation, request-owned deadlines, latest-receipt improvement ordering, DeepL bounds/choices. |
| `node --test --test-timeout=300000 tests/postgres.test.mjs tests/postgres-embedded.test.mjs tests/briefing-expiry-upgrade.test.mjs tests/operational-audit-upgrade.test.mjs tests/verification-authority.test.mjs tests/language-registry.test.mjs tests/neon-rehearsal.test.mjs` | 35 passed — migration inventory, schema verification, upgrade preservation, runtime permissions, Neon rehearsal. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; only pre-existing large-chunk and ineffective-dynamic-import warnings. |

## Browser/fixture checks

| Command | Result |
|---|---|
| `node .verify-live/staff-stabilization-verify.mjs` | Exit 0 on the final build: route titles/focus, unknown routes/settings tabs, settings leave guard, composer checklist, drawers 320/390/820, Arabic search, site language parity. |
| `node .verify-live/stabilization-round2-verify.mjs` | Exit 0 on the final build: Today order/scope/chips, composer Record+Upload/sticky send, text-only send result, Languages tabs/columns. |
| `node .verify-live/update-flow-verify.mjs` | ST-04 pass: Content → Recipients → Review and send; no primary question/language steps; audience selection; Send update; v4 published. |
| `node .verify-live/help-st05-verify.mjs` | ST-05 pass EN/AR: review copy and generated-question copy; Arabic root `lang=ar dir=rtl`. |
| `node .verify-live/worker-st08-wrong-verify.mjs` | ST-08 wrong-answer pass: “Answer did not match”, “I need help”, chat hidden, no “supervisor has been notified”. |
| `node .verify-live/worker-st08-work-verify.mjs` | ST-08 work-completion pass: “Work completed”, answer outcome remains “Matched key facts”, no “Resolved”. |
| `node .verify-live/arabic-sweep-verify.mjs` | ST-13 pass: 14 routes + 3 instruction tabs, all `lang=ar dir=rtl`, no horizontal overflow, localized labels/statuses/errors. |

## Full suite

`npm test` was run on the audit candidate. **Result: 1,794 tests, 1,790 passed, 0 failed, 4 skipped, 0 cancelled, exit 0, 2,154,714.9932 ms (35m 54.7s).** Log: `.verify-live/full-suite-audit.log`.

The four skips are native-only tests that require a real PostgreSQL service; they are not counted as passes. The suite includes SQLite, PGlite, HTTP, migration, authorization, recovery, retention, and browser-fixture checks.

## Not executed / blocked

- Native PostgreSQL roles/TLS/concurrency and native `pg_dump`/`pg_restore`.
- Live provider model quality, account eligibility, and all-locale capability acceptance.
- Real email, push, SMS/WhatsApp, or payment collection.
- Physical microphones, phones, shared devices, and assistive technology.
- Independent security/privacy/accessibility review.
- Load/soak/SLO, deployed monitoring/alerting, off-site DR, and incident drill.
- Native-speaker review of all 15 worker locales and Arabic staff copy.

## Honesty notes

- Synthetic provider success does not verify live model quality.
- Headless media limitations do not prove physical recording is broken.
- Browser viewport checks do not replace physical-device acceptance.
- An automated accessibility scan alone does not prove WCAG compliance.
- The full suite passing does not prove production readiness.
