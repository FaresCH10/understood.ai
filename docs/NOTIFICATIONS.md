# Staff Notifications

Update 2026-10-25: Phase 6 added worker in-app notifications, supervisor push alerts, a
server-side push delivery outbox and the 15-locale worker notification inbox. This
2026-10-08 checkpoint is preserved as historical evidence; where it states that there is no
push or reminder scheduler, see the Phase 6 checkpoint in `BUILD_STATUS.md` for current
behavior and its verified limits.

Update 2026-10-25 (Phase 7): worker deletion now revokes push subscriptions
(`worker_deleted`) and cancels queued/sending deliveries before revoking sessions on both
SQLite and PostgreSQL. Restore quarantine revokes subscriptions (`restore_quarantine`) and
cancels dispatch. Synthetic SQLite-to-PostgreSQL import preserves notification events and
read receipts but omits push subscriptions and deliveries, so a cutover cannot revive device
bindings. Delivery fanout rechecks recipient session and principal state at send time and
expires rather than delivers to an unavailable recipient. See the Phase 7 checkpoint in
`BUILD_STATUS.md`.

Checkpoint: 2026-10-08. This is a site-scoped in-app inbox, not outbound delivery,
scheduled reminders, a worker conversation inbox or production certification.

## Scope and Storage

Active owners, supervisors and auditors can list notifications and explicitly
mark their own items read. Workers, administrators and operators are denied.
The inbox reuses eight immutable audit event kinds: briefing preparation,
publication and withdrawal, worker help, clarification assignment and resolution,
and ready/failed report exports. It does not copy private response text, worker
identities, rubric content, actor details, access tokens or object payloads.
Only generic labels, whitelisted destination views, event IDs and timestamps
are returned. Opening a view does not mark an item read.

GET /api/notifications accepts bounded status/page/pageSize filters. It returns
the site's last 90 days, excludes future events, has stable timestamp/ID sorting,
and performs no read-status writes. POST /api/notifications/:id/read accepts only
an empty body with no query overrides, revalidates account/site/session authority,
and preserves the first read timestamp on replay. Origin checks and no-store
responses apply. Read status is personal, not shared across staff.

SQLite scoped relation guards and PostgreSQL migration 036 enforce same-site
event/staff references. Read receipts reject updates/deletes. Synthetic SQLite
backup-to-PostgreSQL import preserves the receipt and its original timestamp.
The 90-day limit is a display window, not physical deletion. Authorized lifecycle
cleanup/retention of these immutable receipts remains a separate release gate.

## Client Behavior

The lazy inbox has loading, empty, failure, all/unread, pagination, manual refresh,
explicit mark-read and generic queue-navigation controls. It aborts obsolete GET
requests, prevents simultaneous read submissions, and reports uncertain responses
without optimistically confirming acceptance. Refresh reconciles an accepted
lost acknowledgement. There is no automatic POST, unread bell badge, polling,
background upload, email, push or reminder scheduler. The mobile bell is reachable
and uses a fixed 44px target; the previous decorative unread dot was removed.

## Verification

- SQLite and embedded PostgreSQL tests cover filters, exact scope, revoked or
  forged authority, role denies, private-field exclusion, read-only listing,
  independent per-staff receipts, original-timestamp replay, immutable guards,
  rollback and an accepted PostgreSQL commit with a lost acknowledgement.
- Credential-mode SQLite/PostgreSQL HTTP tests cover anonymous/worker/foreign
  scope, origin/query/body denies, sanitized failures, replay and revocation.
- Disposable optimized fixture 82907 seeded 25 synthetic notifications. A real
  mark-read POST committed before the fixture returned 503; UI kept status
  unconfirmed, then Refresh returned 24 unread and the original read timestamp.
  Before cleanup bootstrap reset counters, evidence was one notification POST,
  one read receipt and zero worker POSTs. Reload retained the receipt. Unread
  page two contained four rows with Next disabled. Opening help reached the
  clarification queue, and the mobile bell returned to the inbox without reads.
- Final optimized entry index-BhlnPhLh.js and CSS index-DRP3ntdu.css were observed
  at actual 320px. Labels wrap, the bell is visible without a fake badge, and
  document width is 320px. Initial label clipping was fixed before final capture.
  Screenshot: artifacts/notifications/final-built-unread-page2-320.jpg.
- Full suite 15586: 423 tests, 420 passed, zero failed, three external PostgreSQL
  skips, 76.707 seconds. This precedes only final CSS mobile-header changes;
  strict TypeScript/Vite rebuild and final browser checks follow them. Main is
  499.76 kB / 135.19 kB gzip; all 30 public file hashes match. Earlier suite 70908
  exposed one stale migration-list assertion, corrected before the final run.

Fixture public cache was removed through the device UI, its tab closed, viewport
reset and process stopped. Main verified-live service 66921 was intentionally
restarted as 8700 to load the API/schema. Only 3020/3021 remain listening. The main
inbox reads two existing synthetic events with zero read receipts; no existing
item was marked read. Eight selected business hashes, integrity and foreign keys
match the baseline. Screenshot: artifacts/notifications/main-inbox-desktop.jpg.

## Remaining Gates

Complete reference/accessibility review, worker-specific conversation notifications,
approved delivery/reminders, retention, real PostgreSQL concurrency/TLS/restore,
cloud deployment and live-provider readiness remain unverified. Gemini free tier
remains synthetic-only. No provider call, email, deployment or paid resource was
used for this checkpoint. No Reticle verdict or hardware verification is claimed.
