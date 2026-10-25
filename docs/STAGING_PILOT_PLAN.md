# Gulf pilot staging plan

Prepared 25 October 2026. **Not provisioned and not deployed.** This plan covers
explicitly synthetic staging only. It does not authorize real worker data, live AI,
real email or push, paid resources, public customer use or production startup.

The current release decision remains **NO-GO**. See
[PRODUCTION_RELEASE_GATES.md](PRODUCTION_RELEASE_GATES.md) and
[DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md).

## 1. Scope

- Target customer profile: companies operating in the Arabian Gulf, one pilot
  company, one site unless a second site is separately approved.
- Staff interface: English and Arabic.
- Worker languages: all 14 agreed languages, including both Punjabi scripts.
  Synthetic UI/locale coverage only; live provider quality is unverified.
- Trial: 14 days, no card, no automatic charge, 25 active workers per company
  with an authorized override, no fixed instruction-count limit.
- After trial: read-only until manual subscription activation.
- Data class: synthetic only for this plan. Real data stays blocked until the
  provider/privacy/legal gates are approved.
- Payment gateway: deferred; activation remains manual.

The 25-worker trial cap is a commercial rule, not a measured infrastructure
capacity. This plan proposes separate load targets in section 7.

## 2. Selected free-first stack

| Layer | Candidate | Published free allowance (recheck before use) | Main limitation |
|---|---|---|---|
| Compute | Oracle Cloud Always Free A1, Ubuntu 24.04 ARM64 | 2 OCPU / 6 GB / 50 GB proposed within the 1,500 OCPU-hour and 9,000 GB-hour monthly allowance | Card identity verification and temporary hold; capacity may be unavailable; no uptime SLA; instances may be reclaimed |
| Database | Neon Free PostgreSQL 18 | 1 GB storage, 100 CU-hours/month, six-hour instant-restore window (published terms recorded 25 Oct 2026) | Scale-to-zero, connection limits, short restore window; not a backup service |
| Object storage | Neon Object Storage | 5 GB per current published terms | No proven capacity for audio at 25 workers; soft-delete/erasure accounting is not a production guarantee |
| Edge/TLS | Caddy 2.10 + Let's Encrypt | No certificate purchase fee | Requires a public hostname and reachable ports 80/443 |
| DNS (staging) | DuckDNS subdomain | Free subdomain | Not an owned domain; Resend DNS verification is not documented as compatible |
| Email | Resend Free | 100 emails/day, verified domain required | Needs an owned domain; stays disabled until verified |
| Push | Web Push + VAPID | No notification service fee | Requires HTTPS, installed PWA on iOS, physical-device testing |
| Monitoring | Healthchecks.io Free + external uptime check | 20 monitors, limited history | No paid on-call; alert delivery still needs an operator |
| Backup | Backblaze B2 free | 10 GB storage | Capacity, key custody and restore drill remain unproven |
| Build/deploy | Docker Compose built on the host | No registry fee | ARM64 build must be produced on the host; no automatic deployment |

Rejected: Render Free (free service types exclude background workers, and Render
documents free web services as unsuitable for production). Paid Neon overages,
paid compute, paid storage and paid provider tiers remain disabled.

Sources/records: [Neon PostgreSQL version support](https://neon.com/docs/postgresql/postgres-version-support),
[Neon plans](https://neon.com/docs/introduction/plans),
[Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Resend pricing](https://resend.com/pricing), and the local service register in
[PRODUCTION_RELEASE_GATES.md](PRODUCTION_RELEASE_GATES.md).

## 3. Derived technical identities

These are proposed from the code contract and validated against its patterns. They
are not secrets and do not need to be invented by the product owner.

| Item | Proposed value | Contract |
|---|---|---|
| Staging schema | `understood_stage_gulf` | Matches `^understood_stage_[a-z0-9_]{1,46}$` in `hostedSyntheticConfig` |
| Future production schema | `understood_prod_gulf` | Matches `^understood_prod_[a-z0-9_]{1,46}$`; not used by staging |
| Runtime roles | `understood_api`, `understood_worker`, `understood_operator` | Separate restricted logins; no owner, superuser, `CREATEDB`, `CREATEROLE` or `BYPASSRLS` |
| Maintenance identity | Neon owner login, never used by a service | Required only for migration/ACL commands; removed from runtime files after use |
| Compose proxy address | `172.30.0.10/32` | Fixed by `compose.yaml`; API/worker/operator trust only Caddy |
| Host-Caddy proxy (only if not using Compose) | `127.0.0.1/32` | Exact socket peer only; do not combine with the Compose address |
| API/worker/operator ports | `10000` / `10000` / `10001`, internal only | Only Caddy publishes 80/443 |
| VAPID keys | Generated locally when push is authorized | Do not ask the product owner to invent keys; never place the private key in browser code |
| Candidate fingerprint | Derived from the frozen tree after engineering changes | Current artifact: `artifacts/release-fingerprint-2026-10-25.json`; it is not a frozen candidate |

## 4. Configuration files and where values go

The deployed containers read their own env files on the staging host. The local
`.env.production.local` is not read by those containers. For staging, use a
private host directory such as `/opt/understood/` with mode `0600` files created
from the examples. Do not commit them, print them or paste values into chat.

| File on host | Source example | Values to enter | Where to obtain |
|---|---|---|---|
| `.env.hosted` | `.env.hosted.example` | `UNDERSTOOD_PUBLIC_ORIGIN` (exact HTTPS customer origin), `UNDERSTOOD_POSTGRES_SCHEMA=understood_stage_gulf`, API login URL, `UNDERSTOOD_POSTGRES_TLS=true`, Neon endpoint/region/bucket/access key/secret | Neon console and approved DNS; secrets entered on the host only |
| `.env.hosted.worker` | `.env.hosted.worker.example` | Worker login URL only | Neon console; distinct from API and owner |
| `.env.operator` | `.env.operator.example` | Separate operator origin, customer origin, same schema, operator login URL, `UNDERSTOOD_OPERATOR_ACCESS=true` | Neon console and approved DNS |
| `deploy/.env.caddy` | `deploy/.env.caddy.example` | `UNDERSTOOD_CUSTOMER_HOST`, `UNDERSTOOD_OPERATOR_HOST` (bare hostnames, no scheme) | Approved DNS |
| `.env.maintenance` | Create temporarily from `.env.hosted` | Owner URL, TLS flag, schema | Neon owner console; delete after migration/ACL setup |
| `.env.production.local` | Existing local file | Nothing for staging. Production DB/storage/mail/push/CA/origin/role-profile/approval fields remain absent | Enter later in this gitignored file or an agreed secret manager |

Fields that must stay disabled or empty for the first synthetic boot:

- `UNDERSTOOD_EMAIL_MODE=disabled`, `UNDERSTOOD_RESEND_KEY=`, `UNDERSTOOD_EMAIL_FROM=`,
  `UNDERSTOOD_AUTH_MAIL_KEY=`.
- `UNDERSTOOD_PROVIDER_TESTS=disabled`, all provider adapter fields `disabled`,
  and no `GEMINI_API_KEY` or `OPENROUTER_API_KEY` in API/operator services.
- `UNDERSTOOD_OPERATOR_ACCESS=false` on customer services.
- No real worker content, real inboxes, real devices or customer contacts.

The Postgres URL must be a direct endpoint for migrations and backups. Do not put
`sslmode`, `sslcert`, `sslkey` or `sslrootcert` in the URL. Staging accepts a
certificate-verified TLS URL; production additionally requires an absolute
`UNDERSTOOD_POSTGRES_CA_FILE`, which is not part of the staging example.

## 5. Deployment sequence (after separate authorization)

1. Create the Neon Free project on PostgreSQL 18, one branch, an empty
   `understood_stage_gulf` schema, the three restricted logins and a private
   storage bucket with scoped credentials. Do not use the owner login at runtime.
2. Create the Oracle Always Free ARM64 VM. Review the card hold, region capacity
   and cost estimate first. Restrict SSH to the operator's IP; expose only 80/443.
3. Point the approved staging hostname(s) at the VM. Do not start Caddy before DNS
   resolves; do not disable TLS to work around issuance failure.
4. Copy the repository without env files. Create the host env files from the
   examples, fill them privately, set mode `0600`, and verify `.gitignore` still
   covers `.env*`.
5. Build the image on the host for ARM64, run `npm ci`, `npm run build`,
   `npm run deploy:preflight` and `docker compose config` before starting.
6. Apply the migration ledger with the maintenance identity, configure the three
   runtime ACL profiles with writers stopped, verify every hosted check, then
   remove the maintenance file.
7. Bootstrap one synthetic workspace and one synthetic operator using the bounded
   JSON commands in [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md). No default password or
   public bootstrap endpoint exists.
8. Start the stack with `docker compose up -d`. Leave email and push disabled for
   the first pass. Verify `/api/health`, HTTPS, HSTS, CSP, the exact proxy header
   contract, backend-port isolation and that logs contain no secrets.
9. Run one complete synthetic owner/HR/supervisor/worker journey, including trial
   expiry and manual activation. Capture evidence and then stop the stack or keep
   it only for the approved test window.

A second pass may enable verified email and web push only after the domain and
device authorizations exist. Never use real worker content during staging.

## 6. What must not be claimed after staging

- Staging does not prove production admission; `server/auth.mjs` still refuses
  production and `LIVE_PROVIDER_ADAPTERS` is deliberately empty.
- Free-tier uptime, scale-to-zero latency, Neon connection limits, object-storage
  capacity and certificate renewal are not proven by a local or one-day run.
- Synthetic locale coverage is not native-language quality evidence.
- Browser emulation is not physical-device or assistive-technology acceptance.
- A green staging run is not a release candidate approval.

## 7. Proposed targets for review

These are proposals; they are not measured values or commitments.

### Capacity and load

- Pilot profile: 1 company, 1 site, 25 active workers, 5 staff accounts, 2 devices
  per worker, 14 worker languages/15 locales.
- Load test: 2x the pilot profile (50 workers, 10 staff) for a 30-minute soak.
- Request mix: 10 concurrent HTTP requests, 10 Send operations/minute, 20 answer
  submissions/minute, 4 concurrent audio uploads and 60 push attempts/minute.
- Stop conditions: database pool utilization above 70%, queue age above 60 seconds,
  error rate above 1%, any duplicate Send/answer effect, or quota exhaustion.

### Service objectives

- p95 health response: under 200 ms.
- p95 authenticated API read: under 500 ms.
- p95 answer receipt: under 2 seconds. This measures only server acknowledgement
  and durable storage of the submitted answer; it is not assessment latency.
- Answer assessment completion and queue age: separate, explicitly measured
  objectives. The completion target depends on the approved AI provider and
  model, which do not exist yet (live-adapter registry empty; free-tier AI
  disabled for real worker data). No assessment-completion SLO is claimed now.
- p95 audio upload: under 5 seconds at the test network profile; upload
  completion does not imply transcription or assessment completion.
- Monthly availability: 99.5% aspirational pilot target, externally measured.
  Free tiers publish no SLA, so this is not an availability guarantee.

### Recovery and retention

- RPO: 24 hours from nightly encrypted backups; Neon's six-hour restore window is
  supplemental, not a guaranteed backup.
- RTO: 4 hours for a full isolated restore, measured in a drill.
- Retention: 7 daily and 4 weekly encrypted backups, plus the application's
  existing data/audio retention rules. Do not extend retention without privacy
  review.
- Restore drill: monthly, into an empty isolated target with a distinct identity;
  verify inventory, playback, quarantine and deletion behavior.
- Key custody: backup encryption key stored separately from the storage
  credentials; losing the key loses the backup.

### Device and accessibility matrix

- Android: Chrome on a current Pixel and a Samsung Galaxy A-series device.
- iPhone: Safari on a current iOS release, both browser and installed PWA;
  verify push only after authorization.
- Desktop: current Chrome, Firefox and Edge.
- Widths: 320 px, 390 px, 768 px and 1440 px; 200% zoom and reflow.
- Languages: English and Arabic staff UI; all worker locale/script paths,
  especially Arabic RTL and both Punjabi scripts.
- Assistive technology: NVDA with Firefox/Chrome, VoiceOver on iOS/macOS and
  TalkBack on Android; keyboard-only operation and visible focus.
- Conditions: reduced motion, slow 3G, offline/reconnect, permission denial,
  shared-device logout and notification click-through.

Physical devices and qualified reviewers are required for sign-off; emulators are
supporting evidence only.

## 8. Requirements that cannot be met at $0

| Requirement | $0 status | Consequence |
|---|---|---|
| Real-data AI processor with approved no-training/retention terms | Not available; free tiers are synthetic-only and the live-adapter registry is empty | Production admission and real worker content remain blocked (G6/G7) |
| Verified email sending domain | Requires an owned domain; DuckDNS is not a documented Resend-compatible zone | Owner verification, invitations and recovery cannot be production-verified (G8) |
| Gulf data-residency/legal review | Free-tier regions and provider terms are unverified for Gulf requirements | Customer/legal approval cannot be claimed; privacy review required (G7/G12) |
| Always-on compute with an SLA | Oracle Free has a card hold, capacity limits and no SLA; Render Free is unsuitable | Reliable public hosting and an availability guarantee cannot be claimed (G12) |
| Independent security review | Requires a qualified human reviewer | G10 cannot pass on local scans alone |
| Accessibility/AT, native-language and physical-device review | Requires reviewers and devices | G2/G9/G11 remain open |
| Seven named approvals and G0-G18 manifest | Human sign-off; must not be fabricated | G18 remains NO-GO |
| Capacity/audio storage proof | Neon 1 GB/5 GB and B2 10 GB may be insufficient at 25 workers | Retention and load targets must be measured before any capacity claim (G13/G15) |
| Deployed monitoring, on-call and incident drill | Tools are free; operator time is not | G14 remains open |
| Payment gateway | Deferred by product decision | Not a trial blocker; manual activation remains |

A truthful conclusion: synthetic staging can be attempted at $0 within these
limits, but **100% production GO for real Gulf customer data cannot be reached at
$0 without an approved real-data provider, an owned email domain, reliable compute
and independent human reviews.** Those are scope/approval gaps, not code
percentages.

## 9. Immediate local prerequisite

The proposed production major is PostgreSQL 18. The existing local evidence is
PostgreSQL 16.15, and the repository's ACL verifier requires the PostgreSQL 18
`MAINTAIN` privilege. A local PostgreSQL 18 environment was previously blocked
because `docker run` hangs at container start even though the Docker engine
responds; five prior `understood-test-tools:pg18` containers remain in `Created`
state. The pre-existing `understood-pg-phase7` container must not be touched.

Option 2 was authorized on 2026-10-25: download official PostgreSQL 18 Windows
binaries and run an isolated, disposable user-mode cluster under `artifacts/`.
Work in progress in `artifacts/pg18-user-2026-10-25/`: official download and
checksum verification, loopback-only cluster on port 55481, newly generated
credentials, local CA/server TLS, and isolated databases for migration,
concurrency, permission, TLS and backup/restore checks. Results are recorded when
they exist; no pass claim is made in this plan.

Neither action touches the saved demo database, the pre-existing container or the
services on ports 3020/3021/3031/3243. No external account or real data is needed
for this step.

## 10. Pending external inputs

These remain pending and are not requested for the immediate local step:

- Neon Free account/project on PostgreSQL 18 and a private bucket.
- Oracle Cloud account and Always Free ARM64 VM, after card-hold review.
- Customer/operator hostnames and DNS control, or approval to use a temporary
  DuckDNS name for synthetic staging.
- Owned domain and verified Resend domain for real email.
- Consenting physical devices and controlled inboxes.
- Independent security, accessibility, native-language, privacy and operations
  reviewers.
- Explicit authorization to connect accounts, provision resources, deploy, enable
  email/push or process real worker data.

No approver, approval document, customer name, privacy reference or domain is
invented in this plan.
