# 05 — Security, privacy and SaaS reliability

Baseline `270788d`; 2026-11-11. This is an engineering source/synthetic-test review, not an independent penetration test or legal/privacy approval. No production service was probed.

## Authentication and access

Inspected credential/session paths use scrypt with random salts and timing-safe comparison; session tokens are random, stored hashed, and issued in HttpOnly/SameSite cookies with secure production naming. Staff recovery, worker setup/reset and invitation acceptance have explicit tokens/revisions. Email proof and application session identity are separate, including the Neon registration path. These are positive implementation controls, not proof that any deployed mail configuration works.

Worker sign-in requires company context plus worker credentials, avoiding reliance on a globally unique worker name. Shared-device logout/session revocation and notification binding checks exist. Native phone/browser permission, idle-session behavior and device cleanup were not manually exercised in this audit.

Principal checks revalidate active identities and scope; owner/supervisor, administrator, auditor and worker are distinct. Operator access has separate configuration, credentials and database policy. No confirmed cross-tenant exploit or authentication bypass was reproduced. That statement is limited to the inspected paths and available tests; it is not an assertion that none exists.

## Tenant isolation and database privileges

Core domain queries generally include organization/site ownership and validate the principal before reading or mutating. Negative tests exist for foreign assignments, stale authority, role changes, exports, case actions and private audio. Source inspection also found a newer set of workspace tables without matching database-level relationship constraints (A-07). The HTTP layer's validation mitigates those routes; direct maintenance/import/future writers can still introduce invalid associations. No tenant-leak exploit was established from that gap.

Native PostgreSQL role grants, TLS validation, simultaneous connections and actual runtime identities were not available. PGlite cannot substitute for these checks. Require a disposable PostgreSQL 18 environment and separate application/worker/operator roles before claiming the privilege boundary verified.

## Request and content boundaries

- Mutation Origin checks and explicit origin/proxy configuration are present. Deployment header behavior and trusted proxy addresses require validation against the eventual host.
- Parameterized values are used in examined domain queries; identifier interpolation is guarded by fixed/schema validation helpers. This was not an exhaustive SQL-injection proof of every string construction.
- Attachment limits include 3 MiB per file, five files/10 MiB total, allowlisted types/extensions and signature checks. Live operation requires a scanner; download rechecks content and applies attachment/nosniff/sandbox protections. Scanner service availability and malware efficacy were not externally tested.
- Photo evidence has a current 3 MiB application limit and explicit JSON-envelope allowance. An older schema accepting up to 5 MiB does not by itself mean new uploads use that larger limit.
- Private audio uses scoped object references and authorization, not a blanket public bucket contract. Actual storage ACLs and signed endpoint behavior were not tested.
- Hosted static serving sets CSP and Permissions-Policy. `vercel.json` does not declare equivalent headers (A-09); verify effective Vercel response headers before concluding platform defaults compensate. This is a hardening inconsistency, not a demonstrated XSS exploit.
- Notification endpoint validation limits outbound push hosts. Push subscription/session/principal revocation and cancelled delivery transitions are implemented. Physical-device confidentiality and click navigation remain unverified.

## Secrets and dependencies

A redacted pattern scan selected 1,934 text files from an inventory of 2,824 tracked files and found no candidate live credentials matching the patterns used. It did not inspect complete Git history, all untracked files, binary payloads, entropy-only secrets or existing credential revocation. No secret values were copied into reports.

`npm audit --omit=dev --json` reported zero known vulnerabilities at audit time. This covers the package advisory database, not application authorization, provider privacy, malicious dependencies or all development tooling. Lockfile installation was reproducible in the disposable snapshot.

If a credential was exposed in earlier chat/history, this scan does not establish that it was revoked. Verify replacement and revocation through the responsible account owner as a separate operational action; do not print or rotate live credentials during this audit.

## Privacy and retention

Deletion first deactivates the worker and revokes grants/setup tokens/sessions/push, then asynchronous redaction, pseudonymization and private-object removal establish completion evidence. Retention policy intentionally separates source/answer audio, response text, cases, generated speech, activity and briefing content. Successful application cleanup does not prove provider logs, disconnected devices or backups erased content; the source itself states that limit.

Restore tooling replays privacy/access restrictions and quarantines sessions/push. Historical notification events/receipts are distinct from active delivery bindings. Native restore, off-site encryption/key custody, restore freshness and RPO/RTO were not exercised. No claim of full deletion or disaster recovery is warranted from unit tests alone.

For real workers, provider DPA, processing region, retention, no-training terms, recording notices and authorized employer access need documented approval. DeepL/fallback and speech/assessment/transcription decisions must be stage-specific. Script detection or fixture fluency is not a translation safety assessment.

## Entitlements, billing and resource controls

Explicit pending/expired entitlements are intended to deny operational writes. Missing entitlement remains unmanaged/write-allowed (D-04), so real-data admission must account for legacy tenants explicitly. No public self-upgrade exploit was established. Billing records use integer cents, payment balance checks, row locks, replay validation and unpaid-void restrictions. Manual payment recording does not automatically alter entitlement, consistent with assisted activation.

Pilot duration currently contradicts the approved 30-day contract (A-01). Instruction history is not bounded by the worker cap, and library query work is unbounded by page size (A-08). Provider budgets, stage controls and admission gates should remain enabled rather than weakened to obtain a green demo.

## Reliability and release evidence

Implemented mechanisms include job leases, bounded retries, idempotent receipts, provider-call journals, worker heartbeat and storage/provider readiness checks. Liveness, worker heartbeat and successful provider configuration do not establish language quality or end-to-end delivery. The inline deadline sharing defect is separately reproduced (A-05).

Production admission is intentionally fail-closed and expects approvals tied to the candidate/configuration. The current mismatch with required DeepL routing must be corrected without bypassing admission. Historical release artifacts do not certify the audited commit. Independent security/accessibility review, all-language acceptance, real mail/push, native database/restore and realistic load testing remain release gates.

No P0 exploit was confirmed. Known high-priority functionality/data risks and incomplete operational evidence still prevent a trustworthy real-worker release.

## Development/build advisory follow-up

The all-dependency locked-install scan exited 1 with eight high-severity affected package entries in Vite/Reticle and its transitive Zod chain (A-12). Production-only scan remains clean. Reachable vulnerable paths and production artifact instrumentation are unverified; see issue register A-12 and task T12 for applicability, evidence and safe remediation. No dependency was changed during this audit.
