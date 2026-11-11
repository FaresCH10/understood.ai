# Production Gemini integration

Production preparation and follow-up use `gemini-deepl-approved-v1`: Gemini handles preparation, grounding/translation checks, speech and assessment; DeepL translates instruction, presentation and follow-up content. Source transcription, speech, assessment and recording retain `gemini-approved-v1` identities. The synthetic Gemini adapter retains its synthetic-data restriction and exact fixture allowlists. No real provider request, account change, credential update, deployment or release approval is performed by this change.

## Implemented runtime

- The hosted launcher selects production admission only when the tier is explicitly `production`. Missing or expired release approvals, synthetic/demo settings, unknown providers, unsafe roles, invalid TLS/proxies, and missing service configuration block startup.
- Gemini and paid DeepL credentials exist only in the worker overlay. The API uses provider metadata and database queues. The operator gets a separate origin/database role and no customer storage, mail, push or provider credentials.
- Preparation, grounding checks, translation checks, private speech, recorded-source transcription, legacy recorded-answer assessment, typed assessment, and case follow-ups use the existing durable quota journal and claim checks. Multiple-choice grading stays deterministic against the frozen option IDs.
- Production transcription sends the canonical WAV inline in one content-generation request. It creates no provider Files resource. Speech requests a complete WAV and validates/normalizes the returned bytes before private storage. Structured responses omit model thought parts and have byte limits.
- Approved-language presentation translation runs in the worker, including translated answer options and cached presentations that still need options. Options retain their grading IDs. Provider quota pauses defer the job without using up attempts or claiming successful translation.
- Release expiry is checked again before provider dispatch. Closed quotas, missing models, invalid output, lost authority and unsupported languages cannot fall back to synthetic results.
- Mail and Web Push use the existing real adapters through the admitted runtime and worker stages. Registration, invitation, recovery, and push delivery still require actual credentials and controlled delivery acceptance.

## Configuration and migration

Copy `.env.production.example`, `.env.production.worker.example`, and `.env.production.operator.example` to the matching ignored files. Keep every existing configured environment file intact. Fill server-only secrets outside source control. Set the actual evaluated text/transcription/speech model IDs and voice; production inherits no synthetic model defaults. Declare only language capabilities supported by the chosen models and approved release scope.

`UNDERSTOOD_GEMINI_PAID_ACCOUNT=true` is a required account-policy declaration; it is not proof of account billing, privacy terms, language quality or available quota. Confirm these independently before live use. No billing is enabled by the application.

Apply migrations 111 and 112 after 110 with the maintenance identity and all writers stopped. Reapply the application/worker/operator permission profiles because `presentation_translation_jobs` is new. Existing synthetic operations and publications remain unchanged. Production operations retain a distinct `real` data class and are accepted only with the registered production adapter's provenance.

The production Compose files mount `deploy/runtime/` read-only at `/run/understood/`. Put the reviewed database CA chain in `deploy/runtime/postgres-ca.pem` and the actual signed-off release record in `deploy/runtime/release-approval.json`. The folder is excluded from Git, Docker build context and static publishing. The example approval JSON deliberately has pending gates and empty approvals; it cannot authorize startup. Do not convert unverified checks into passed gates.

The customer/operator DNS names in `deploy/.env.caddy` must match their configured origins. Keep API, worker, operator and maintenance database logins distinct. Preserve the existing exact proxy-header contract.

## Local checks and launch commands

`npm run production:preflight` checks the three configuration contracts, release approvals, service separation, origins and build output without network requests. `npm run production:admission` checks one environment loaded into the current process. Neither command migrates, deploys, verifies a cloud connection, sends mail/push or certifies production readiness.

The launcher commands stay `npm start`, `npm run hosted:worker`, and `npm run hosted:operator`; the selected tier determines the admitted runtime. Do not pass the Gemini worker environment to `npm start`.

After external release gates and deployment authorization are complete, the reviewed Compose definition is `compose.production.yaml`; the optional operator overlay is `compose.production.operator.yaml`. Existing staging Compose files remain unchanged. Follow the maintenance, backup, role and proxy procedures in DEPLOY_RUNBOOK.md with the production contracts. Production containers use the same read-only, non-root isolation and only Caddy publishes ports.

## Acceptance still needed outside this code change

Supply and validate actual server settings, a suitable Gemini account and evaluated models, a verified mail sender, VAPID settings, PostgreSQL/private storage credentials, native database permissions, public TLS/DNS, physical-device delivery, language quality, capacity, backups and the release approvals. Mocked local tests prove application integration; they do not prove these external services.

Protocol references: [Gemini content generation](https://ai.google.dev/api/generate-content), [audio input](https://ai.google.dev/gemini-api/docs/generate-content/audio), and [speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation). Confirm current model/account support before enabling any real requests.

## Stabilization translation contract (2026-11-11)

Apply additive migrations 126–128 with the maintenance identity after backup and reviewed migration planning; no live migration was performed during stabilization. 126 updates latest-receipt improvement guards without rewriting old signals. 127 validates retained workspace metadata/ownership and aborts on anomalies without deleting rows. 128 admits composite provider evidence and binds translation stage model to DeepL. Reapply/verify role profiles for new functions and current schema.

Set `UNDERSTOOD_TRANSLATION_ADAPTER=deepl-v2`, `UNDERSTOOD_DEEPL_PAID_ACCOUNT=true`, a JSON `UNDERSTOOD_DEEPL_TEXT_LANGUAGES` array supported by the current account, and `UNDERSTOOD_DEEPL_CAPABILITY_REFERENCE` pointing to independently reviewed account capability evidence. Only the worker receives `DEEPL_API_KEY`; free `:fx` keys are refused. These settings are declarations, not generated privacy/provider approvals.

Keep `UNDERSTOOD_PROVIDER_FALLBACK=disabled`. A scope containing Sinhala (`si`) or Shahmukhi Punjabi (`pa-Arab`) is currently refused by DeepL-only admission. The product's required 15 locales are unchanged; do not present the supported-only mock integration as all-language acceptance. A fallback needs a new explicit provider/privacy decision, implementation and native quality acceptance. Translation failures never silently use Gemini or synthetic content. Reviewed terminology is checked by Gemini after DeepL translation; a mismatch fails instead of silently altering instructions.

Each DeepL network call passes through the same durable request journal, budget and authority fence as the Gemini stages. Manifests bind translator identity and a hash of the reviewed capability declaration. Production builds exclude Reticle instrumentation; development retains it. Re-freeze candidate/configuration approvals after these changes.
