# Deployment runbook: synthetic staging only

For the separate production code path and contracts, see [PRODUCTION_GEMINI_INTEGRATION.md](PRODUCTION_GEMINI_INTEGRATION.md). The procedures below retain their synthetic staging scope; production still requires its completed external gates and release approval.

This runbook prepares and operates the packaged synthetic staging stack. It is
not production approval and it does not authorize real worker data, live AI,
paid resources or public customer use. Nothing in this repository has been
deployed to a cloud host. Running these steps is the deployment action.

The application still fails closed when `UNDERSTOOD_TIER=production`. All runtime
services reject unknown adapters, missing TLS, unsafe roles, an unverified
migration ledger or an untrusted proxy. See [HOSTED_RUNTIME.md](HOSTED_RUNTIME.md)
for the boundary and [DEPLOYMENT_TARGET.md](DEPLOYMENT_TARGET.md) for the selected
free-tier services.

## What the package contains

- `Dockerfile`: multi-stage build, production dependencies only, non-root `node`
  user, no build context secrets.
- `compose.yaml`: Caddy reverse proxy, API and worker. Only Caddy publishes ports.
  Application containers are read-only, drop all capabilities and forbid privilege
  escalation. The proxy address is fixed at `172.30.0.10`; API and worker trust only
  that exact address.
- `compose.operator.yaml`: optional separate operator service on its own origin.
- `deploy/Caddyfile*` and `deploy/caddy/*.caddy`: TLS termination and the exact
  header-overwrite contract (`Host`, `X-Forwarded-Proto: https`, exactly one
  `X-Forwarded-For`).
- `scripts/deploy-preflight.mjs`: offline validation of build outputs, deployment
  files, proxy contract and the three environment contracts. It never connects to
  a database or the network.

## Prerequisites

1. A Linux host with Docker Engine and Compose v2. The selected free-tier candidate
   is documented in [FREE_HOST_SETUP.md](FREE_HOST_SETUP.md); stop before installing
   anything until the card hold and ownership are resolved.
2. A DNS A/AAAA record for the customer host and, if used, the operator host.
   Ports 80 and 443 reachable from the internet.
3. A Neon Free PostgreSQL branch, an empty `understood_stage_*` schema and four
   database logins: one schema owner/maintenance login (never used by a service),
   plus distinct unprivileged `api`, `worker` and `operator` logins. No role
   memberships, superuser, `CREATEDB`, `CREATEROLE` or `BYPASSRLS`.
4. A private Neon S3 bucket and credentials scoped to that bucket.
5. Server-only secrets. Never commit them, print them or put them in browser fields.

## 1. Environment files

```sh
cp .env.hosted.example .env.hosted
cp .env.hosted.worker.example .env.hosted.worker
cp .env.operator.example .env.operator
cp deploy/.env.caddy.example deploy/.env.caddy
chmod 600 .env.hosted .env.hosted.worker .env.operator deploy/.env.caddy
```

Set:

- `.env.hosted`: exact `https://` customer origin, `understood_stage_*` schema,
  the **API** login URL, `UNDERSTOOD_POSTGRES_TLS=true`, Neon storage fields, and
  `UNDERSTOOD_TRUSTED_PROXY_NETWORKS=[]` (Compose overrides it with the fixed
  proxy address). Leave email disabled until separately approved.
- `.env.hosted.worker`: the **worker** login URL only.
- `.env.operator`: exact and different operator origin, operator login URL, and
  the customer origin. No storage, AI or mail credentials.
- `deploy/.env.caddy`: bare hostnames matching the origins exactly.

Compose auto-loads a repository `.env` only for `${...}` interpolation; this
package does not interpolate it, and containers receive only their declared
`env_file`. Do not add `${...}` references to `.env`.

The database URL must not contain `sslmode`, `sslcert`, `sslkey` or `sslrootcert`.
TLS is configured separately and certificate verification stays enabled.

## 2. One-time database setup

Create the schema and roles as the Neon owner. Use a password manager, not shell
history:

```sql
CREATE SCHEMA understood_stage_synthetic;
CREATE ROLE understood_api LOGIN PASSWORD '<generated>';
CREATE ROLE understood_worker LOGIN PASSWORD '<generated>';
CREATE ROLE understood_operator LOGIN PASSWORD '<generated>';
```

Create a temporary `.env.maintenance` (gitignored) containing only the owner URL,
`UNDERSTOOD_POSTGRES_TLS=true` and `UNDERSTOOD_POSTGRES_SCHEMA`. Never load it into
a running service, then remove it after this section.

Apply the migration ledger exactly once, then configure each runtime profile with
**all writers stopped**:

```sh
node --env-file=.env.maintenance server/postgres/migrate.mjs
node --env-file=.env.maintenance scripts/postgres-permissions.mjs configure understood_api --dedicated-database --writers-stopped
node --env-file=.env.maintenance scripts/postgres-permissions.mjs configure understood_worker --profile=worker --dedicated-database --writers-stopped
node --env-file=.env.maintenance scripts/postgres-permissions.mjs configure understood_operator --profile=operator --dedicated-database --writers-stopped
```

Startup never applies DDL or repairs ACLs. Re-run the configure commands after
every migration that adds tables or columns, before restarting writers.

Verify each role with the matching service environment:

```sh
node --env-file=.env.hosted scripts/postgres-hosted.mjs check
node --env-file=.env.hosted --env-file=.env.hosted.worker scripts/postgres-hosted.mjs check-worker
node --env-file=.env.operator scripts/postgres-hosted.mjs check-operator
```

### First workspace and operator identity

Both are explicit maintenance commands with bounded JSON on standard input; no
default password or public bootstrap endpoint exists. For the workspace command,
copy `.env.hosted` to a temporary `.env.hosted-maintenance`, replace the database
URL with the owner URL, run the command, then delete the file. See
[WORKSPACE_BOOTSTRAP.md](WORKSPACE_BOOTSTRAP.md) for the exact JSON contract.

```sh
node --env-file=.env.hosted-maintenance scripts/postgres-operator.mjs --bootstrap-workspace < workspace.json
```

For the operator identity, copy `.env.operator` to `.env.operator-maintenance`,
replace the URL with the owner URL, and run:

```sh
node --env-file=.env.operator-maintenance scripts/postgres-operator.mjs --provision-operator < operator.json
```

`operator.json` contains only `id` (UUID), `name`, `email` and `password`. The
maintenance URL must not be placed in `.env.operator` or given to the running
operator service.

## 3. Validate before starting

```sh
npm ci
npm run build
npm run deploy:preflight
docker compose config
docker compose build
```

`deploy:preflight` fails unless the build is optimized, the Dockerfile copies the
required build inputs, all deployment files are present, the proxy contract is intact,
the three environment contracts pass the real hosted-config validator, and API/worker
logins are distinct and non-owner. It performs zero network requests and never prints
secret values. `docker compose build` was not executed locally because image registry
downloads stalled; run it before any start.

## 4. Start

```sh
docker compose up -d
docker compose ps
docker compose logs -f api worker
```

Operator (optional, separate origin and login):

```sh
docker compose -f compose.yaml -f compose.operator.yaml --profile operator build
docker compose -f compose.yaml -f compose.operator.yaml --profile operator up -d
```

Caddy obtains certificates automatically. If the host has no public DNS yet,
starting Caddy will fail certificate issuance; fix DNS first, do not disable TLS.

## 5. Verify

- `curl -fsS https://<customer-host>/api/health` returns
  `{"status":"ok","mode":"synthetic-credential",...}`.
- The HTML response includes the application CSP and revalidated HTML caching; Caddy
  adds HSTS. Confirm hashed assets are immutable after a rebuild.
- The backend port is not published: only 80/443 are bound by Caddy. From another
  host, connecting to port 10000/10001 must fail.
- Log in with the bootstrapped synthetic owner, complete a synthetic
  briefing-to-answer flow and confirm worker assets load over HTTPS. Do not use
  real worker content.
- `docker compose logs` contains no secrets or raw provider errors.
- Production startup still fails closed. Do not weaken it to test.

## 6. Operations

- Before any migration or ACL change: stop API, worker and operator, take a
  database backup, apply with the maintenance login, reconfigure every profile,
  verify, then restart. See [POSTGRES_BACKUP.md](POSTGRES_BACKUP.md).
- Rebuild and recreate with `docker compose build && docker compose up -d`. A
  restart replaces hashed frontend assets; keep a maintenance window or run a
  second API instance until old tabs have reloaded. The PWA shell caches the
  verified asset set.
- Back up `caddy_data` if certificate reissue is undesirable. Neon owns database
  and object storage; application containers keep no durable state.
- `docker compose down` stops the stack but keeps the Caddy volumes. Never use
  `down -v` unless certificate loss is acceptable.
- Rotate any credential that was pasted into chat, logs or a ticket. Rotating a
  database password requires updating the matching env file and recreating only
  that service.

## Local validation status

On 21 October 2026 the package was exercised locally with synthetic data only:

- Four-shard suite: 1,343 tests, 1,339 pass, 0 fail, 4 skips. The three
  real-PostgreSQL skips passed separately against a disposable local PostgreSQL 16
  container; only the native pg_dump/restore backup test remains skipped.
- `npm run build`, a production-dependency-only check and the exact Docker build
  context pass. The build stage must copy `server/`, which the TypeScript build imports.
- `npm run deploy:preflight` with a populated contract returns `ready:true`,
  `deployed:false`, `productionReady:false` with zero network requests. The local
  loopback files used for this check were removed; recreate real files from the
  examples before starting.
- `docker compose config` parses the base and operator profiles.
- A throwaway PostgreSQL 18.4 cluster applied 95 migrations, configured the
  API/worker/operator ACLs and passed each hosted check over certificate-checked TLS;
  the API served health/static/proxy-rejection behaviour, a worker health row was
  registered, and the separate operator shell denied customer routes.
- The Docker image itself was not built and Caddy/TLS/DNS were not started, because
  registry blob downloads stalled. No host, cloud account, DNS, billing or real data
  was used.

See `artifacts/deploy-validation-2026-10-21.json`.

On 22 October 2026 the packaging chain was exercised further, still locally and
with synthetic data only:

- The Docker image built successfully (`understood:production-check`) and runs as
  uid 1000 `node` with no environment files in the image. The API container rejected
  missing/altered proxy headers, served the CSP/HSTS/immutable-asset contract through
  the trusted headers, and rejected direct access from an untrusted network.
- Caddy 2.10 validated the customer and customer-plus-operator configurations. A local
  TLS run with Caddy's internal CA confirmed HTTPS delivery, 308 HTTP-to-HTTPS
  redirects, header overwrite (spoofed multi-address `X-Forwarded-For` and
  `X-Forwarded-Proto: http` were replaced), HSTS, CSP and immutable hashed assets.
  Public ACME issuance and renewal remain unverified because no public DNS exists.
- The native `pg_dump`/`pg_restore` round-trip test passed against the disposable
  PostgreSQL 18.6 TLS cluster (1/1, 17.9 s), including private object readback,
  quarantine, immutability and cleanup. This closes the previously skipped native
  backup gate; a deployed Neon backup/retention drill is still required.
- `npm audit --omit=dev` reports zero vulnerabilities and a repository secret scan
  found no credential material outside the gitignored environment files.

See `artifacts/runtime-verification-2026-10-22.json`,
`artifacts/caddy-2026-10-22/results.json` and
`artifacts/pg-local-2026-10-22/backup-native-2026-10-22.log`. No host, cloud account,
DNS, billing or real data was used.

## Remaining production gates

This stack is still synthetic staging. Real worker data, live AI dispatch, email,
hosted concurrency, backups/restore rehearsal, the A01-A18 acceptance gates, the
44-screen visual/accessibility audit, monitoring/alerting and an independent
security review remain open. Do not change `UNDERSTOOD_TIER` to production; the
application will refuse to start.
