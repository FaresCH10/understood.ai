# 04 — Technical architecture, database and API audit

Baseline `270788d`; 2026-11-11. Read together with the reproductions and test limitations in report 08. No application changes were made.

## Architecture and systemic risks

The product has an operational domain rather than a collection of placeholder screens. Receipts, authority fingerprints, publication snapshots, storage provenance and separate worker processes are useful foundations. The principal maintenance risk is parallel implementations: SQLite repositories, PostgreSQL repositories, and shared workspace SQL coexist. Their differences are not all accidental: PostgreSQL supports asynchronous multi-process execution and explicit privileges. Consolidating every repository would be a risky rewrite; first define and test the same domain contracts in both engines.

Confirmed drift: SQLite presentation/response readers consider `instruction_deliveries.content_json`; PostgreSQL presentation, response-detail and check-back readers do not consistently do so. An initial publication snapshot cannot contain languages delivered later. A single documented content-selection contract, with engine-specific query implementations, is the smallest useful architectural correction (A-03/A-04).

`src/main.tsx` remains a very large route/state coordinator. The repository also has many deliberately separate recovery helpers. This is not evidence that all state is broken. High-impact changes should preserve request IDs, session authority and stale-result checks rather than replace recovery with component-local optimistic state. Extracting code is justified only alongside a demonstrated defect or testable boundary.

## Database and migrations

| Area | Evidence and assessment |
|---|---|
| Migration engine | `server/postgres/migrate.mjs`: numbered/checksummed migrations; line-ending compatibility tests; runtime startup has a separate schema-verification path. There are 124 files, latest number 125. Missing number 117 alone does not demonstrate an unapplied migration |
| Core relationships | Composite tenant/site relationships and immutable evidence triggers occur throughout the core schema; ownership is also checked in application queries. Do not infer that every table has equivalent guards |
| New workspace tables | Migration 114 leaves compositions/attachments without tenant/site/staff/request foreign keys; completion references only assignment ID. Disposable PostgreSQL execution accepted nonexistent identities, invalid JSON/date text and negative attachment bytes (A-07). Application validation mitigates HTTP paths but does not enforce database integrity for every writer |
| SQLite compatibility repair | `server/instruction-schema.mjs:25`: composite-worker-FK detection drops the delivery table without checking data or actual invalidity. Reproduced loss of one valid ledger row (A-06) |
| Transaction boundaries | `domainTransaction`, principal revalidation, advisory locks and row locks protect many state changes and replay receipts. Attachment scanning is intentionally outside a transaction with subsequent revalidation |
| Latest answer ordering | Core response paths use immutable submission receipt sequence; repeats bind to accepted receipt timestamps. Improvement analytics instead uses timestamp/attempt ID and disagrees on ties (A-11) |
| Job concurrency | SQL leases/tokens and completion authority checks are implemented. PGlite execution cannot prove independent native connections, TLS or non-owner permission behavior |
| Entitlements | Absence of an organization entitlement is explicitly treated as unmanaged/write-allowed. This is a policy decision needing resolution for real tenants, not proof of an arbitrary HTTP bypass (D-04) |
| Backups | Native dump/archive/restore validation, privacy ledger replay and quarantine are implemented; actual native/off-site restore evidence was unavailable in this audit |

For A-07, add constraints only after reporting existing inconsistencies and deciding how to repair them. Do not delete invalid historical rows to make a migration pass. Test additive migration from the current schema with representative retained data and verify both application and worker privilege profiles.

## API contracts and integrations

- Entry points are `server/index.mjs` and `server/postgres/http.mjs`; `api/gateway.mjs` adds Vercel transport constraints. Shared input modules reject malformed IDs, extra fields and invalid state/mode combinations in many commands.
- Principal/session authority must be checked on the server. Current PostgreSQL domain helpers re-read active staff/worker/site/session context; UI affordances are not the authorization boundary.
- Request IDs and exact-payload comparisons make many mutations recoverable after a lost response. Preserve the distinction between replaying an accepted command and initiating a new write after expiry/revocation.
- External work generally uses queues and stage verification. Adapter support, configured credentials and a release-approved capability are separate facts. Current production translation does not implement the agreed DeepL-primary route (A-02).
- A shared deadline in the cached synthetic inline adapter lets overlapping requests refresh another request's budget (A-05). Keep deadline ownership request-local; a global concurrency limiter, if retained, must have an independent contract.
- Email/push/object storage implementations exist, but no real delivery, provider outage or private-bucket configuration was exercised. Retry code does not prove delivery to a person.
- Manual invoice/payment endpoints are not a payment processor; there is no established live payment-webhook lifecycle to certify. Do not invent webhook defects for an absent/deferred integration.

## Frontend/backend consistency

Worker work status, response status, delivery readiness and case resolution are distinct. `assignmentWorkStatus` and the shared SQL work-state expression should remain aligned with read models, crew history, library filters, notifications and reports. Existing tests cover many individual states; the new late-delivery reproductions expose combinations missing from those checks.

Language preference and assignment language deliberately differ. Approved language changes create presentation artifacts, not edits to historical evidence. A-03 shows the source lookup can fail before translation starts. A-04 shows a supervisor can see English answer choices while the delivered question was Hindi. Neither is solved by changing only UI labels.

Multiple-choice is now generated for new question instructions. Its selected IDs are assessed deterministically; the voice-answer API rejects this response mode. That is inconsistent with earlier free-form requirements unless the product change was approved (D-02). It is not appropriate to enable recording without changing validation, assessment and evidence contracts together.

## Performance and scalability

The library's apparent pagination occurs after loading all site briefings/publication snapshots and assignments into JavaScript (`server/workspace.mjs:103–126`). Cost grows with total history, not displayed page size (A-08). The 25-worker pilot limit does not bound instruction history. Push filtering/counting/order into scoped SQL and measure query plans before adding a cache.

Clarification listing intentionally caps at 5,001 rows and asks users to narrow filters; this is a disclosed limit, distinct from unbounded library loading. Crew history already performs significant scoped grouping/pagination in SQL; preserve frozen report-audience membership when optimizing it.

Build passed with two large client chunks (approximately 1.03 MB and 1.36 MB before gzip) and ineffective dynamic-import warnings. No realistic network/device load target was measured. Prioritize functional corrections, then measure worker first interaction and staff navigation with realistic retained history. Bundle size alone is not a reproduced latency failure.

## Technical debt worth addressing

1. Shared authoritative delivered-content contract plus cross-engine contract scenarios.
2. Safe, explicit compatibility migrations instead of destructive runtime schema repair.
3. Independent product-policy assertions, rather than tests importing the same incorrect constant.
4. Capability and provider policy expressed consistently across runtime families.
5. Bounded query work at API pagination boundaries.

No rewrite, ORM migration, new cache, new queue service or framework change is justified by the evidence collected.

## Development/build advisory follow-up

The all-dependency locked-install scan exited 1 with eight high-severity affected package entries in Vite/Reticle and its transitive Zod chain (A-12). Production-only scan remains clean. Reachable vulnerable paths and production artifact instrumentation are unverified; see issue register A-12 and task T12 for applicability, evidence and safe remediation. No dependency was changed during this audit.
