# Deployment target (not deployed)

19 October2026: the user asked to continue building locally for now after
reviewing Oracle's card-verification hold. No signup, card confirmation,
account connection, billing change, cloud test or deployment is part of the
current work. Free-host instructions remain optional background material.

The selected database and private-storage target is **Neon Free PostgreSQL and
Neon Object Storage**. The founder rejected enabling Cloudflare billing and later
configured a private synthetic Neon bucket. The Neon adapter is implemented;
separate bounded database and private-storage tests have passed at their documented
scopes. See NEON_APPLICATION_STORAGE_REHEARSAL.md and NEON_STORAGE_PRIVACY_GATE.md.
Those tests do not prove a deployed combined system or permanent storage erasure.

The earlier compute proposal was a Render Node web service and background worker.
It is not a provisioned or verified free hosting choice. Compute hosting, region,
trusted proxy behavior and applicable cost/availability still need verification
and explicit activation authorization. No R2 account/billing or paid PostgreSQL
is required by the selected Neon configuration. The R2 adapter remains only an
explicit compatibility option, not authorization to enable Cloudflare billing.

Checked19October2026: Render's documented Free service types exclude background
workers, and its free web services idle down; Render warns against production use
of those instances. The old Render proposal is therefore not a verified no-cost
production target. See [Render Free documentation](https://render.com/docs/free).
The user requested free-host setup steps. [FREE_HOST_SETUP.md](FREE_HOST_SETUP.md)
documents an Oracle Always Free candidate, card-verification/availability limits,
and a server-only stopping point. No host has been provisioned or selected as a
verified production target. No account connection, billing change or public
deployment is authorized by the setup request. Neon Free remains the selected
database/private storage.

Do not provision paid PostgreSQL or automatically upgrade Neon. Free database
hosting does not imply free compute. The user configured isolated Neon test
resources; approved disposable synthetic databases/roles were tested and removed.
No public application endpoint, billing change or customer activation is proved.
This target is not verified production readiness.

## Neon connection and capacity gates

- Use the existing `pg` client and `UNDERSTOOD_POSTGRES_URL`. Set `UNDERSTOOD_POSTGRES_TLS=true`; certificate verification stays enabled. Remove URL `sslmode`, `sslcert`, `sslkey`, and `sslrootcert` parameters because this application configures TLS separately and rejects conflicting URL overrides. Never print the secret connection URL or commit it.
- Neon supports [standard PostgreSQL connection strings and pooled endpoints](https://neon.com/docs/get-started/connect-neon). Use a direct endpoint for migrations, cutover and backup/restore checks; validate a pooled runtime endpoint against the real concurrency suite before selecting it. Repository advisory locks and search paths are transaction-local. The existing pool is bounded to eight connections per process.
- The [2 October 2026 free-plan announcement](https://neon.com/blog/neon-free-plan-1-gb-per-project) describes 1 GB storage per project and a six-hour instant-restore window. Recheck actual project quotas in the console before launch. A short provider restore window is not a substitute for independent encrypted backups and a tested restore.
- Prove startup after scale-to-zero, request latency, worker compute consumption, connection limits, storage/transfer headroom and safe quota-exhaustion behavior with synthetic data. Pause admission and alert an operator when capacity is exhausted; never claim availability or enable billing automatically.

Before deployment:

An explicit synthetic-only hosted web/worker launcher now exists with optimized static delivery, TLS-proxy validation and Secure cookies. See [HOSTED_RUNTIME.md](HOSTED_RUNTIME.md) for commands and unverified proxy/cloud gates. A Docker/Compose/Caddy package with an offline preflight and runbook now wraps that launcher; local PostgreSQL18.4/TLS runtime checks passed, but the image build and Caddy transport were not executed because Docker Hub blob downloads stalled. See [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md). This does not enable production or real-data processing.

1. Preserve the runnable local SQLite mode. The separate PostgreSQL repository now has95 migrations and scoped transactions. On21October2026 all three current policy profiles were configured on a throwaway PostgreSQL18.4 cluster, and each hosted check verified over certificate-checked TLS; PostgreSQL17 or older cannot verify the runtime ACLs because the verifier requires `MAINTAIN`. Wider failure/concurrency, pooling and deployed acceptance remain open. Do not migrate the original database automatically.
2. Use the private Neon adapter for the selected hosted target. The isolated six-family application storage test passed; combined native/hosted operation, scoped credentials, history/final-erasure accounting and private backup/restore remain open. Never make the bucket public.
3. Run API, worker and operator as separate services and database identities, with private server-only secrets, health/readiness probes, structured logs, bounded queues and tested backups. Prove the actual host's proxy/transport contract before provisioning or publishing; do not assume Render compatibility or free compute.
4. Finish invitation/recovery, retention/export/deletion, cost controls, accessibility, real-device testing, the remaining selected screens, and a security review before live workers.
5. Keep free-tier Gemini limited to synthetic evaluation. Real worker content needs a separately privacy-approved provider/data policy. No production mode may silently fall back to the synthetic processor.

Provider documentation and pricing can change. Recheck terms and costs before purchasing or publishing.

Public PWA shell deployment contract: serve the final generated `dist` output at root over HTTPS with correct HTML/JavaScript/CSS/manifest/image MIME types, public non-personalized HTML, and revalidated worker script headers. Preserve earlier hashed assets during rolling updates. The service worker excludes protected APIs/audio and access-link queries. The built local fixture proves only this static contract; the Render runtime/static delivery, update behavior and real-device installation remain deployment gates. See `PUBLIC_SHELL.md`.
