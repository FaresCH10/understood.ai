# Hosted synthetic runtime

This is a deployment foundation, not production approval. The launcher accepts only explicit `staging`, synthetic AI/data, credential access and an isolated `understood_stage_*` schema. Production, real data, demo access and ordinary free-tier worker-content dispatch fail closed. Fixed synthetic verification has a default-off, worker-only opt-in described below. The loopback rehearsal launcher remains available.

## Fixed Synthetic Verification

Only the staging worker can receive `GEMINI_API_KEY` and opt in to
`UNDERSTOOD_PROVIDER_TESTS=gemini-free`. The API/operator configurations and
factories reject provider credentials/adapters. Use the blank
`.env.worker-verification.example` overlay only in the separate worker settings;
it does not enable any ordinary content pipeline. Default remains disabled.
The dedicated operator service has no provider key/function: it reads fresh
worker capability hashes, requires the reviewed configuration fingerprint and
queues an authenticated, confirmed, quota-reserved fixed test. No observation,
stale/stopped/incompatible workers or conflicting configurations block new tests.
Original receipts survive unavailability. See VERIFICATION_WORKER_CAPABILITIES.md
for local evidence and WORKER_HEARTBEAT.md for independent atomic publication,
failure fencing, drain ordering and remaining native/network-stall/hosted gates.
These source changes are not authorization to configure, deploy or run live tests.

## Commands

The dedicated synthetic operator service now has `npm run hosted:operator` and
`npm run hosted:check-operator`. Use the separate `.env.operator.example` contract,
distinct operator LOGIN and distinct HTTPS origin. It verifies migration088 and
the positive operator column profile before listening,has no storage/provider/
mail handle and rejects all customer APIs. Current UI entry is `/`,with a
standalone operator HTML/JS dependency allowlist,no customer bootstrap or PWA,
no-store HTML,worker-src none and microphone/camera/geolocation disabled.
Rebuild the new operator.html/.vite manifest before authorized startup;older
builds fail closed. OPERATOR_ENTRY.md records local and composite verification.
This is locally verified startup,not an authorized or executed cloud deployment.
See OPERATOR_COLUMN_PROFILE.md for setup/admission and remaining release gates.

Use `.env.hosted.example` as the environment contract. Supply server-only secrets through hosting secret settings, never browser fields or committed files. Build with `npm ci` and `npm run build`; run the web process with `npm start` and a separate worker with `npm run hosted:worker`. `npm run hosted:check` verifies the migration ledger and application runtime role; `npm run hosted:check-worker` requires the narrower worker profile. Use separate API and worker database login URLs. API/worker startup rejects unsafe roles, schema-owner credentials and fenced read-only source roles. RUNTIME_PERMISSIONS.md documents separate maintenance ACL setup; the staged worker profile is not a complete least-privilege or separate operator-HTTP profile. These commands do not create schemas, seed identities, migrate data, provision cloud resources or verify cloud storage/provider connections.

## Packaged deployment

`Dockerfile`, `compose.yaml`, optional `compose.operator.yaml`, `deploy/Caddyfile*`,
`scripts/deploy-preflight.mjs` and [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md) package the
same launcher behind Caddy. Only Caddy publishes 80/443; API, worker and operator run
read-only, non-root and capability-free on a fixed subnet, and trust only Caddy's
fixed address. Compose replaces the example's empty proxy list with `172.30.0.10/32`.
The multi-stage image uses production dependencies only. Its build stage must copy
`server/` because the TypeScript build imports server contracts.

Local validation on 21 October 2026 used a throwaway PostgreSQL 18.4 cluster: 95
migrations were applied, the API/worker/operator ACL profiles were configured, and
each service's hosted check passed over certificate-checked TLS. The API served
health/static assets while rejecting missing or altered proxy headers; the worker
published a health row; the operator origin rejected the customer host and customer
APIs. Evidence is in `artifacts/deploy-validation-2026-10-21.json`.
The Docker image build, Caddy startup/TLS issuance, public DNS, Neon connectivity and
any deployed acceptance were not executed; Docker Hub blob downloads stalled. No
host, cloud account or real data was used.

The web process binds `0.0.0.0` on `PORT`. It loads a bounded allowlist of optimized `dist` files at startup with correct MIME types, hashes, immutable hashed assets, revalidated HTML/worker script and a self-only CSP. Protected APIs/audio, source files, maps and environment files are not in this map. Preserve older hashed assets across rolling releases; deployment-level verification remains required.

The PostgreSQL client requires certificate-verified TLS to Neon Free. The selected
no-billing stack is Neon Free for PostgreSQL and private Object Storage. Set
`UNDERSTOOD_STORAGE_ADAPTER=neon` and the five `UNDERSTOOD_NEON_STORAGE_*` fields
in API/worker secret settings only;never in the separate operator service.
Only supported HTTPS Neon branch endpoints,
matching regions and explicit credentials are admitted. Clients use path-style
S3 addressing, conditional object creation, bounded reads and SHA256 integrity
checks. The unchanged R2 option remains available only when explicitly selected
or for backward compatibility when the adapter setting is absent. Unknown
adapters fail closed. This does not authorize enabling Cloudflare billing.

Dedicated `.env.neon-storage-test` settings and ambient AWS_* variables do not
auto-select or supply hosted Neon configuration. The existing local preview
stays on its original storage. Migration087 extends the immutable storage-probe
journal to name Neon separately; apply migrations only to an explicitly approved
target with the maintenance role, never automatically at runtime startup.
Storage probes are opt-in; pending cleanup continues. Mail defaults to disabled.

An isolated live Neon S3 smoke test passed on2026-10-15: authenticated synthetic
WAV readback, anonymous denial, conditional overwrite rejection and current-branch
removal. It is not deployed application acceptance. Neon soft-deletes objects;
stored lifecycle/versioning configuration is not enforced. Branch-history
retention and irreversible privacy erasure need separate accounting and approval.
No real worker data is approved for this setup. All-family application paths,
cloud access policy, private backup custody, restore and hosted acceptance remain
open. See NEON_PRIVATE_STORAGE_TEST_SETUP.md for exact evidence and limits.

## Proxy contract

TLS must terminate at a trusted reverse proxy. Set `UNDERSTOOD_TRUSTED_PROXY_NETWORKS` to a JSON array of exact socket peer IPs or narrowly scoped CIDRs. Empty lists and `/0` networks are rejected. The backend must not be reachable by untrusted clients. The proxy must overwrite client-supplied headers, not append or trust them:

- `Host`: the exact configured HTTPS origin host, including a nondefault port.
- `X-Forwarded-Proto`: exactly `https`.
- `X-Forwarded-For`: exactly one validated client IP, no chain.

Other transports are rejected before static files/customer routes. Auth throttling uses the verified client IP. Customer cookies use `__Host-understood_session`, Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. Hosted customer/worker configuration rejects the operations switch; it must stay false. The separate operator HTTP service uses `__Host-understood_operator` with the same host-only attributes and rejects every customer API. Its dedicated positive column profile is required before listening; an application/worker/owner connection is rejected. Existing same-origin and authenticated-session-context mutation checks remain. See OPERATOR_COLUMN_PROFILE.md.

`GET /api/health` without forwarded protocol is a minimal load-balancer check with no tenant data. It verifies database connectivity, not worker/provider/storage readiness. Other backend requests require the proxy contract. SIGTERM/SIGINT closes web connections with a 25-second deadline; the worker finishes its current awaited stage before stopping.

Render documents [web-service PORT/binding](https://render.com/docs/web-services), [Node build/start commands](https://render.com/docs/deploy-node-express-app), and [shutdown behavior](https://render.com/docs/deploys). Its exact trusted socket ranges/header-overwrite contract have **not** been established here. Do not widen trust to all networks or claim Render compatibility without proving that contract. No deployment/purchase occurred. Free database hosting does not imply free compute/storage.

## Evidence

`tests/hosted-runtime.test.mjs` uses isolated synthetic PGlite and actual local HTTP with simulated proxy headers. It proves configuration rejection, explicit Neon selection, read-only startup, optimized file delivery, cookies, origin checks, credential scoping, IP budgets, logout and disabled demo/operator behavior. Private-store tests cover scoped WAV/original bytes, integrity failures, conditional conflicts, definite absence and sanitized failures through the shared R2/Neon implementation. These tests do not prove real hosted TLS, Neon concurrency/pooling, all cloud application paths, Render, DNS, browser CSP/PWA, rolling updates or process-kill recovery. Explicit fresh synthetic workspace provisioning is documented in `WORKSPACE_BOOTSTRAP.md`; full site lifecycle, live AI/privacy approval and final release/reference/accessibility/device checks remain. Production startup is intentionally unavailable until required gates are satisfied.
