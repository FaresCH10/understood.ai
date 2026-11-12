# 05 — Security, privacy, and SaaS reliability audit

## Scope and evidence

This is a source/test review plus synthetic browser and PGlite checks. It is not an independent penetration test, privacy audit, or production certification. No real worker data, production database, live provider, real email/push, or physical device was used.

## Authentication and sessions

- Custom credential auth with scrypt password hashes, opaque hashed session cookies, `HttpOnly`, `SameSite=Strict`, secure cookies in hosted mode, origin/CSRF checks, and auth-attempt budgets.
- Worker access uses one-use high-entropy grants and/or worker passwords with credential revisions. Sessions are revalidated against active principal/site/tenant state.
- Staff account memberships support multi-site access; role changes and credential changes revoke affected sessions.
- **Residual risk:** no independent auth review, no MFA, no external IdP/SSO. Session/device acceptance is synthetic.

## Authorization and tenant isolation

- Server-side scoping is pervasive: `org_id`/`site_id`/`worker_id` checks, composite foreign keys, and scoped queries.
- Tests cover cross-tenant/cross-site denial, forged IDs, revoked grants, disabled workers, expired sessions, suspended tenants, and read-only workspaces.
- Operator access is a separate service/origin with separate credentials and no automatic worker-content access.
- **Residual risk:** dual-engine drift can create a route that is scoped on one engine but not the other. Route parity and negative tests must remain part of CI.

## CSRF, CSP, and browser security

- Mutation origin checks and same-site cookies are present.
- The audit added a shared CSP constant used by the Node static server and Vercel. The policy is `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`.
- **Residual risk:** CSP was not verified on a deployed HTTPS host; inline styles are allowed; no independent XSS review.

## Uploads and private storage

- Audio/photo/attachment validation covers type, size, duration, WAV integrity, and private storage references.
- Private reads are server-mediated; signed/streamed reads are scoped to the authenticated principal.
- **Residual risk:** no real malware scanner in the default local path; no native object-storage/TLS acceptance; no physical-device recording test.

## Secrets and configuration

- Provider keys are server-only; production admission rejects demo/synthetic fallbacks and requires explicit configuration.
- The operator service rejects private-storage/AI/mail secrets; the audit extended the operator secret pattern to include `DEEPL_API_KEY`.
- `.env` files are not printed or committed. The untracked `.verify-live/secret.txt` was not read or committed.
- **Residual risk:** no secret-rotation drill; no independent configuration review.

## Entitlements, billing, and abuse controls

- Pilot/entitlement state, read-only expiry, worker/site caps, usage requests, manual invoices/payments/voids, and audit receipts exist.
- No automated subscription/payment collection or webhook signature path exists; this is a product gap, not a hidden implementation.
- Auth/mail/provider budgets and rate limits exist for key paths.
- **Residual risk:** manual billing reconciliation, no payment-provider security review, no load-based quota test.

## Retention, deletion, and privacy

- Retention policies, text/audio/activity/case/generated-content purges, deletion redaction/pseudonymization, restore quarantine, and audit evidence exist.
- Application cleanup does not prove provider/backup/device erasure; this is documented.
- **Residual risk:** native backup/restore, off-site DR, key custody, and deletion drills are not verified.

## Reliability and operations

- DB-backed jobs/leases, retries, dead-letter/failure states, worker heartbeat, and operator controls exist.
- The audit fixed a shared provider deadline and a destructive SQLite schema repair.
- **Residual risk:** no deployed monitoring/alerting, no load/soak/SLO evidence, no process-kill/native concurrency drill, no incident drill.

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| R3-01 | P1 | Late-delivery content authority could show/assess the wrong language. | Fixed and regression-tested. |
| R3-02 | P1 | Recorded-answer processing used the snapshot question for late-delivered languages. | Fixed and regression-tested. |
| R3-03 | P1 | SQLite startup could drop a populated delivery ledger. | Fixed and regression-tested. |
| R3-04 | P2 | Workspace tables accepted invalid ownership/JSON/date/attachment metadata. | Fixed with additive constraints/guards. |
| R3-05 | P2 | Library pagination materialized all site history. | Fixed with SQL paging. |
| R3-06 | P2 | Vercel omitted the Node CSP. | Fixed with shared policy. |
| R3-07 | P2 | Improvement analytics used non-authoritative latest-answer ordering. | Fixed with receipt ordering. |
| R3-08 | P2 | Shared inline provider deadline could be extended by another request. | Fixed with request-owned adapters. |
| R3-09 | P2 | DeepL response parsing was unbounded; optional-question choices could shift. | Fixed. |
| R3-10 | P1 decision | Pilot duration 14 vs 30 days. | Unresolved product decision; current contract preserved. |
| R3-11 | P1 decision | Production translation policy Gemini vs DeepL-primary. | Unresolved provider-policy decision; current fail-closed routing preserved. |
| R3-12 | P1 external | All-locale live capability/quality not established. | Blocked/external. |
| R3-13 | P3 | Send-result document title mismatch. | Open. |
| R3-14 | P2 product | No automated subscription/payment collection. | Documented product gap. |
| R3-15 | P2 | Staff Urdu falls back to English. | Documented; no native review. |
| R3-16 | P2 | Development/build dependency advisories. | Partially mitigated; package upgrade deferred. |

## Verdict

No P0 cross-tenant exploit or data-corruption path was confirmed in the reviewed scope. The product is **not production-ready** because unresolved policy decisions, external provider/device/security/accessibility acceptance, native PostgreSQL/DR, and deployment authorization remain open.
