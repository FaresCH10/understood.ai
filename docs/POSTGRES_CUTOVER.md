# Synthetic SQLite migration rehearsal

2026-10-11 preservation update: the importer serializes with the migration ledger,
discovers every current schema table except the migration ledger itself, and
locks/checks all of them before importing. Server-quoted identifiers cover unusual
names. Future/new PostgreSQL-only evidence cannot be overlooked by a stale table
allowlist. Disposable tests reject preserved rows in new/unusually named tables
without source imports or target mutation, and retain normal dry-run/replay.
The final combined cutover/runtime/case/text/recovery run passes 24 checks. This
does not implement or prove PostgreSQL database/private-object backup/restore.

This is a migration rehearsal, not a switch of the running app. The application still uses SQLite and production startup remains blocked. No hosted database, real worker data, cloud credentials or external connection was used.

`server/postgres/import-sqlite.mjs` imports a verified local backup into an **empty, isolated PostgreSQL test schema**. It preserves publication snapshots, historical assignments, responses, clarification records, recording metadata, receipt sequence order, crews, import/export records and prior audit events. The source backup and current local database are not rewritten.

## Safety contract

- Explicit synthetic-only declaration; the utility does not inspect content to prove it is synthetic. Do not label real data synthetic.
- A backup made by `scripts/local-backup.mjs` is required. Quiesce writers first. Integrity, reference, checksum and WAV checks must pass before any import transaction.
- Unsupported tables/columns, missing current receipt evidence, invalid sequences and more than 100,000 imported rows are rejected. It does not invent missing legacy ordering.
- Import uses one PostgreSQL transaction, locks the target tables, refuses any preexisting application rows, and never resets/deletes/overwrites a target.
- Default mode rolls back **data writes**, including receipt identity restart. CLI schema migrations still persist before the dry-run; this is not a completely read-only command. See PostgreSQL's [transactional sequence restart behavior](https://www.postgresql.org/docs/current/sql-altersequence.html).
- An explicit `--commit` imports once. Replay of the same request UUID and backup returns the stored count receipt; a different backup under the same UUID fails.
- Staff credentials and login-throttle records are omitted. Local recovery tokens and encrypted pending-mail jobs are recognized but also omitted: their credentials are not imported, and cutover must not replay local reset links or delivery. Migration 020 creates PostgreSQL recovery tables; the importer locks and requires these targets to be empty too. Migration 021 account identities/memberships are preserved as structure, without passwords; legacy backups may omit them. Reprovisioning a linked imported staff grant keeps its original credential anchor. Original source/backup rows remain unchanged. Imported sessions/grants are revoked. Authentication must be separately provisioned and verified before any cutover.
- Notification events and read receipts are preserved as immutable in-app history. Push subscriptions and delivery attempts are recognized but omitted, so a cutover cannot revive a device binding or dispatch a queued local push. See `NOTIFICATIONS.md` for deletion and restore-quarantine revocation behavior.
- Migration 022 invitation history/requests/acceptance/account links are preserved as structure. All invitation recipient/mail ciphertext is removed, pending invitations/mail are expired and imported link hashes are revoked; nothing can be accepted or delivered from an outstanding local invitation. Native restore applies the same outstanding-link invalidation while retaining accepted receipts. Legacy backups may omit invitation tables. Synthetic native-backup cutover tests preserve source rows and accepted membership evidence; production recovery remains unverified.
- Interrupted preparation/export work is requeued, interrupted recording processing becomes retryable, incomplete storage is failed, and already-expired import/export payloads are cleared.
- Legacy open `Help requested` cases retain their original worker text in immutable `help_requests` before supervisor notes can replace it. Already-resolved legacy SQLite cases may have lost that text under the old overwrite behavior; the importer does not invent missing evidence.
- No audio object is uploaded/copied to R2. The verified private WAV bytes remain in the backup/local storage. A real cutover still needs object transfer and end-to-end private playback verification.
- Backups remain unsigned/unencrypted. Checksums detect corruption, not malicious substitution. This utility is not a production backup-security policy.

## Disposable local server usage

Only after an operator explicitly provides a local test database and creates an empty schema, set `UNDERSTOOD_POSTGRES_URL` in a protected environment. The CLI accepts loopback hosts, a database name containing `test`, and an explicit `understood_test_...` schema. It refuses the `public` schema and remote destinations. Do not put secrets into source or share them in chat.

```powershell
# Replace the placeholders with an existing verified synthetic backup, empty schema and new UUID.
node server/postgres/import-sqlite.mjs --synthetic-backup D:/understod/backups/NEW_BACKUP --schema understood_test_cutover --request-id REQUEST_UUID
# Review the dry-run counts and target before using the same UUID to commit.
node server/postgres/import-sqlite.mjs --synthetic-backup D:/understod/backups/NEW_BACKUP --schema understood_test_cutover --request-id REQUEST_UUID --commit
```

Nothing has been run against a real PostgreSQL server yet. Do not use the migration-owner connection in a web process.

## Verified evidence

`node --test tests/postgres-import.test.mjs` runs an isolated temporary SQLite/WAV backup into PGlite's embedded PostgreSQL engine. It checks dry-run rollback and unchanged identity sequence, commit counts, frozen publication content, same-millisecond audio/typed ordering, next sequence value, revoked imported access, omitted credentials, retained crews/import/export rows, exact report parity, scoped report denial, failure rollback, replay and conflicting-backup rejection. Source sessions remain active.

`server/postgres/reports.mjs` provides active staff/site recheck, repeatable-read snapshots, publication selection, latest evidence, metrics and language breakdown. It is wired to isolated credential HTTP rehearsal, **not the default browser app**. Shared response-order comparison handles PostgreSQL bigint strings without text-order or precision errors.

Async auth/domain/worker/people/import/export/audit/help HTTP repositories now have isolated embedded checks. Remaining gates: browser contract cutover, runnable PostgreSQL services, approved external wire/TLS/concurrency tests, runtime least-privilege role, real legacy-data review, object transfer/restore and deployment/rollback drills. See `POSTGRES.md` and `READINESS.md`.
