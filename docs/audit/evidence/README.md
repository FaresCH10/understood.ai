# Audit evidence

Source baseline: `270788d`, 2026-11-11. These files contain synthetic data, public dependency metadata and redacted observations. They contain no live credentials. No application source was modified to produce them.

## Reproduction scripts

From the repository root with the candidate's locked dependencies and Node 24 installed:

```powershell
node docs/audit/evidence/repro-local-invariants.mjs
node docs/audit/evidence/repro-late-delivery.mjs
```

The first uses in-memory SQLite, a fake clock and a mock fetch; the second migrates a disposable in-memory PGlite database. They do not read a configured database URL, contact a provider, send mail/push or retain a worker database. `test-key` literals are inert mock values, not usable credentials. The scripts print observations; during approved implementation, turn the failing invariants into assertion-based regression tests rather than treating process exit zero as proof the application is correct.

Original captured outputs are `local-invariants-output.txt` and `late-delivery-output.txt`. Generated choice ordering/UUIDs can vary, but the demonstrated failure states should reproduce on the baseline. SQL directly creates invalid rows in the PGlite fixture to test database constraints; this is not evidence those rows can be created through the HTTP API.

## Other artifacts

- `build-output.txt`: locked-snapshot `npm run build`, including TypeScript and Vite warnings.
- `dependencies.json`: production-dependency advisory report; zero reported vulnerabilities is not a security certification.
- `tracked-secret-scan.json`: inventory/text selection counts and redacted findings. Pattern scope: selected text extensions, Resend/Google/GitHub/NVIDIA key-like strings and PEM private-key headers. Not a full-history/entropy/binary/untracked scan.
- `contract-summary.json`: mocked-provider contract and semantic subset metrics. Intentionally invalid-output cases must be interpreted separately from the semantic subset. No live AI evaluation.
- `local-evaluation-summary.json`: failed local synthetic assessment evaluation, including unsupported rubric cases and outcome disagreements; separate from mocked contract success.
- `pipeline-rehearsal.json`: isolated scripted-provider/PGlite journey with memory private storage; includes explicit native-auth/cloud-storage/pilot-acceptance limitations.
- `full-suite.tap` and `full-suite-summary.json`: completed full local run and exact four native skips; 1,766 passed, 0 failed, 4 skipped, exit 0.
- `all-dependencies.json` and `affected-dependency-tree.txt`: all-dependency scan exit 1, eight high affected package entries; applicability not established.
- `SHA256SUMS.json`: SHA-256 hashes of audit reports/evidence, excluding the manifest itself; identifies captured artifacts, not release approval.

External capability reference consulted during the audit: [DeepL supported-language documentation](https://developers.deepl.com/docs/getting-started/supported-languages) and its [official documentation source](https://github.com/DeepL/api-docs/blob/main/docs/languages/using-the-languages-api.mdx). Current account/resource-specific language capability must be verified through the provider; a hard-coded map, consumer translator page or SDK language union is insufficient. No claim is made here that a particular paid account supports all required locales or scripts.

## Integrity and scope

The source archive and dependencies were installed at:

`C:\Users\Hussein\AppData\Local\Temp\understood-audit-20261111-270788d`

Only tracked baseline files were used for execution; working-checkout dependencies, `.env` files, saved demo databases and running previews were not used. Audit reports/evidence are new documentation in the working checkout. Artifact hashes identify evidence, not a release approval or a guarantee of independent provenance.

## Authorized fixes — later evidence

`fixes-*` artifacts belong to the subsequent authorized stabilization. See ../IMPLEMENTATION.md and fixes-full-suite-summary.json for exact raw results and passing reruns. The initial exploratory TAP was stopped, and the later full TAP has two expectation failures corrected by separately captured reruns. Timezone/Unicode `before` files deliberately contain reproduced failures; final-workspace tests are passing evidence. Do not describe intermediate artifacts as final passing runs. The native Docker attempts did not establish a PostgreSQL test instance. Candidate manifests distinguish the full-run source from post-run workspace/test corrections. No single green final full-run claim is made.
