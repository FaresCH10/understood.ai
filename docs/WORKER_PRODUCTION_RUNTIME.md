# Worker runtime and file release

The local `npm run dev` command remains a synthetic development runtime. Production mode is an explicit selection, never inferred from an AI key or from a Vercel deployment name.

## Vercel API

Set `UNDERSTOOD_TIER=production`, `UNDERSTOOD_AI_MODE=live`, `UNDERSTOOD_ACCESS_MODE=credential`, and `UNDERSTOOD_DATA_CLASS=real`, together with the existing `.env.production.example` contract. Use the restricted **application** database login in `UNDERSTOOD_POSTGRES_URL`, a verified CA file, an `understood_prod_*` schema, private storage, production model/language settings and provider release scope. The API must not receive the Gemini key; the background worker does.

Supply the actual reviewed release manifest either as `UNDERSTOOD_RELEASE_APPROVAL_FILE` or as the bounded `UNDERSTOOD_RELEASE_APPROVAL_JSON` environment variable. Never both. Existing candidate fingerprint, gate evidence, named review, validity and approved language checks still apply. No manifest was fabricated or enabled by this change.

`server/vercel-neon.mjs` now selects the existing production service configuration when production is explicitly requested, verifies the database application permissions and passes the live pipeline configuration into the handler. It retains Neon registration verification. The Vercel transport uses the platform's overwritten forwarding headers and requires `VERCEL=1`, an exact approved HTTPS origin and a known deployment host; the self-hosted transport retains exact trusted proxy IP checks. Partially real/live settings cannot silently select synthetic mode.

`GET /api/health/readiness` in production Vercel mode reports a small operational summary. It returns 503 if no healthy queue-worker heartbeat was observed in 30 seconds or the attachment scanner is not configured. It exposes no tenant records, job contents, worker IDs or secrets. “Ready” is an operational check, not proof of model/language quality or a substitute for release acceptance tests.

## Durable worker

Vercel request handlers do not run an infinite queue loop. Use the existing `npm run hosted:worker` command on a persistent Node 24 worker service. `compose.vercel-worker.yaml` provides a worker-only deployment, without a duplicate public API or a dependency on a local API container. It uses the existing production common environment plus worker overrides, restricted worker database login, separate Gemini key, reviewed manifest/CA volume, automatic restart, graceful shutdown and heartbeat health check.

Configure the API and worker to the same database/schema, release candidate, customer origin and model/language scope. The worker must use its own database login and role profile, not the API login or database owner. A new worker starts and verifies migrations/permissions before processing. Existing worker heartbeat, stage failures, retries and shutdown handling remain in use. The worker health check reports shared queue-worker availability, rather than identifying a particular container.

No Vercel or Neon settings were changed and no service was deployed during this code update. Before real workers enter, prove the hosted flow: instruction preparation → translation/speech → publication → worker response → supervisor result, plus restart/retry recovery. Only enable languages whose generated text, choices and speech have been reviewed for the release scope.

## Files: supported transport and malware scanner

Gateway attachments are now **3 MiB each**, with five files and 10 MiB total per instruction. Base64 encoding a 3 MiB file produces 4 MiB, leaving JSON headroom under Vercel's 4.5 MB function payload ceiling. The client, request-body cap and server file check agree. Existing larger rows are preserved, but downloads through this gateway ask the supervisor for a smaller file. Larger-file support requires direct private-object-storage uploads/downloads with expiring signed URLs and a durable quarantined-object lifecycle; that migration is not implemented here. Audio storage already uses the existing private storage adapter independently.

In real production, attachments are released only after a genuine configured malware scanner returns a clean verdict. Set these API-only environment variables:

```
UNDERSTOOD_ATTACHMENT_SCANNER_URL=https://your-scanner-domain/scan
UNDERSTOOD_ATTACHMENT_SCANNER_KEY=<server-side-token-at-least-16-characters>
```

Deploy a scanner service backed by an actual malware scanning engine. Its endpoint receives an authenticated `POST`, `Content-Type: application/octet-stream`, raw file bytes, `X-File-Sha256`, `X-File-Content-Type`, and a percent-encoded `X-File-Name`. It must return JSON with **exactly** `sha256` (the digest of those bytes) and `verdict` (`clean` or `infected`). Example response shape only:

```
{"sha256":"<the-request-file-digest>","verdict":"clean"}
```

The endpoint must be HTTPS, must not redirect, and must respond within 15 seconds with a body no larger than 4 KiB. Tokens stay on the server. Unknown verdicts, bad hashes, network failures and missing scanner configuration fail closed. Uploads are scanned before database insertion; rejected files are not persisted. Downloads are scanned again before any bytes are returned, including uploads from before scanner configuration. Local synthetic fixtures do not claim to be scanned. The scanner service must not use an LLM or a file-extension check as a substitute for an engine.

`GET /api/workspace/attachment-policy` is authenticated and advertises upload availability and limits. The composer displays unavailable scanning as a service state; server checks remain authoritative. Photos have an enlarged preview and PDFs have a sandboxed preview with download fallback. Existing organization/site/assignment authorization and private download headers remain enforced.

This first integration keeps bounded attachments in the existing database and uses scan-before-release rather than a persisted quarantine queue. Direct object storage and background quarantine/scanning remain necessary for larger files or higher-volume use. Scanner capacity and privacy/retention terms must be confirmed with the chosen service before sending real files.
