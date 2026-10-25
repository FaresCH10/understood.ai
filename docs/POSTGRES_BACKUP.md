# PostgreSQL And Private Object Recovery

Implemented maintenance workflow, 11 October 2026. This is not a production
readiness verdict. A bounded native Neon round trip passed on 15 October 2026;
see NEON_BACKUP_REHEARSAL.md. It covers one synthetic local private recording,
full native relational inventory and quarantine, not private R2, all object
families, off-host key custody, complete cutoff/reconciliation or activation.
The saved SQLite preview is not a source or destination of these commands.

2026-10-12: retention requires the exact authenticated quarantine/replay/cleanup
predecessor and records controlled commits and irreversible removal boundaries.
Migration 083 adds retained cleanup transition receipts; use the current migration
contract in a fresh source capture, never rewrite an old backup ledger or migrate
the protected preview. RESTORE_CLEANUP_ACCOUNTING.md covers v3 evidence and recovery.

## Scope

`scripts/postgres-backup.mjs` creates an encrypted native custom-format PostgreSQL
archive for the complete application schema, together with encrypted private
objects and an encrypted completion manifest. It does not reconstruct a database
by inserting a hand-maintained subset of JSON rows. PostgreSQL documents custom
archives and synchronized snapshots in [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

The database inventory hashes every table discovered in the schema, including the
migration ledger and future/quoted tables, plus sequence values and constraint,
trigger and function definitions. Constraint validation state is preserved. The
three intentionally unvalidated historical provider-provenance checks from
migrations 067-069 remain honestly unvalidated; unknown historical inputs are not
invented. Other unvalidated constraints reject backup.

Six private object families are covered: worker recordings, source canonical WAVs,
source originals, generated briefing/question speech, generated case follow-ups
and case voice audio (worker messages plus migration095 private staff in-person
recordings, with explicit immutable authorship). The staff purpose reuses the
existing private object family; no public bucket or seventh family is created.
Retired/deleted/cleaning/unaccepted objects are
not copied. Their relational tombstones and evidence remain in the archive. A
cross-family UUID collision, missing accepted object, wrong size or wrong hash
rejects completion. The encrypted manifest is written last; an incomplete
directory is not a backup and is never reused or automatically deleted.

This is an application-schema archive, not a cluster backup or point-in-time
recovery service. Global roles, owner/ACL grants, unrelated schemas and external
extension dependencies require separate operator preparation. Native restore
omits original ownership/ACL grants and never disables immutable-evidence guards.
PostgreSQL documents the restore transaction and ownership controls in
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## Before Backup

1. Use a direct database endpoint, not a Neon pooler endpoint. Install trusted
   `pg_dump`/`pg_restore` version 16 or newer, compatible with the server. Set
   `UNDERSTOOD_PG_DUMP`/`UNDERSTOOD_PG_RESTORE` when they are not on PATH.
2. Pause jobs and provider dispatch through the authorized operator controls.
   Stop **all** API writers and workers, including privacy cleanup. A job pause
   alone does not stop cleanup. Wait for outstanding leases to expire and worker
   shutdown observations to settle. Do not run this against the active preview.
3. Provision an operator-only backup/scratch parent directory. Each command
   creates new exclusive child directories and rejects symbolic-link paths.
   Restrict inherited Windows ACLs separately: POSIX file modes do not establish
   Windows confidentiality. Use encrypted disks for restore scratch space.
4. Store a separate random 256-bit hex key in a secret manager and supply it as
   `UNDERSTOOD_BACKUP_KEY`, outside source control. Do not paste keys into chat,
   commands, logs or screenshots. Losing this key loses the backup. Key rotation,
   backup expiry and off-host replication remain operator/release work.
5. Configure `UNDERSTOOD_POSTGRES_URL`, `UNDERSTOOD_POSTGRES_TLS=true` and an
   explicit trusted `UNDERSTOOD_POSTGRES_CA_FILE` for a remote connection.
   Connection URL options are rejected. Native credentials use a private temporary
   passfile, not argv or `PGPASSWORD`; arbitrary inherited PostgreSQL/provider
   environment variables are not forwarded. Do not log the environment.
6. Explicitly select `UNDERSTOOD_BACKUP_STORAGE=local` and
   `UNDERSTOOD_AUDIO_ROOT`, or `UNDERSTOOD_BACKUP_STORAGE=r2` with the maintenance
   account's `UNDERSTOOD_R2_ACCOUNT_ID`, `UNDERSTOOD_R2_BUCKET`,
   `UNDERSTOOD_R2_JURISDICTION`, `UNDERSTOOD_R2_ACCESS_KEY_ID` and
   `UNDERSTOOD_R2_SECRET_ACCESS_KEY`. R2 keys need scoped private object reads;
   restore keys additionally need exclusive writes and bounded bucket listing.

Example, after configuring secrets and stopping writers:

```powershell
node scripts/postgres-backup.mjs backup D:\private-backups\NEW-BACKUP D:\private-scratch\NEW-BACKUP-SCRATCH --writers-stopped
```

The source must have current verified migrations, paused jobs/providers, no
recent live worker observation and no outstanding operation/cleanup lease.
Migration serialization and shared locks cover every application table while
`pg_dump` uses the exported snapshot and object copies are verified. The source
database is not edited. Native warnings, timeout, failure, object corruption or
incomplete coverage prevent the completion manifest.

## Isolated Restore

Never restore over an active database, bucket or local audio directory. Prepare a
new database with no user tables/functions/types and no running application, plus
a new empty private storage namespace. Stop any target writers and keep the target
network inaccessible to customers. The routine removes only the checked-empty
schema shell when needed, without `CASCADE`; it does not use `--clean`, overwrite
existing objects, or automatically activate the target.

Use `UNDERSTOOD_RESTORE_POSTGRES_URL`, `UNDERSTOOD_RESTORE_POSTGRES_TLS` and
`UNDERSTOOD_RESTORE_POSTGRES_CA_FILE`, plus the corresponding
`UNDERSTOOD_RESTORE_BACKUP_STORAGE`, `UNDERSTOOD_RESTORE_AUDIO_ROOT` or
`UNDERSTOOD_RESTORE_R2_*` variables. Source and target connection identities must
differ. The schema name comes from the authenticated manifest, not a rewrite.

```powershell
node scripts/postgres-backup.mjs restore D:\private-backups\BACKUP D:\private-scratch\NEW-RESTORE-SCRATCH --isolated-target --trusted-archive
```

Trust the original database/operator and archive source before using the command.
Authenticated encryption and checksums do **not** make an untrusted dump safe:
restoring a PostgreSQL dump executes source-defined SQL. This warning is documented
by [PostgreSQL](https://www.postgresql.org/docs/current/app-pgrestore.html).

The command authenticates the entire encrypted archive before native SQL runs.
Restore uses a single transaction, stops on errors, and preserves all schema/data
relations. Exact relational hashes, sequences, definitions, object inventory and
current migrations are verified before the restored database is changed.

Then one audit-atomic quarantine operation disables credential accounts and
platform operators, revokes customer/operator sessions, push subscriptions, worker grants,
reset and invitation links; cancels queued/sending push deliveries; expires queued private
mail and pilot inquiries; cancels pending invitations; suspends all tenants; pauses jobs/providers;
disables provider policies; and marks interrupted provider requests/verifications
uncertain instead of fabricating completion. Existing publications, assignments,
receipts, accepted provider evidence and deletion/retention journals stay intact.
Elapsed export/import payloads are expired through existing guarded transitions.

Every retained private object is decrypted, exclusively saved and read back with
exact hash/size verification. Every omitted object must be definitively absent;
provider errors or unknown bucket state never mean empty/absent. Only then is an
encrypted `restore-result.enc` written. It states `activationAllowed:false`,
`privacyReconciliationRequired:true` and `productionReady:false`.

If restore fails, leave the target isolated. Before quarantine runs, a restored
database may still contain historical active credentials; no target application
may be started. After quarantine, an interrupted object restore remains suspended
with no success result. Do not retry into the same nonempty target or delete
evidence automatically. The temporary plaintext archive/passfile is removed on
normal success/failure; process termination can leave scratch files requiring
authorized cleanup. Confidential scratch-disk erasure is not claimed.

## Release Remains Closed

The isolated `retention` command now executes elapsed policies and existing
worker-deletion jobs, verifies retired-object absence and retained-object integrity,
and writes an encrypted, backup-bound observation. It never activates access.
See RESTORE_RETENTION.md for admission, pending/failure behavior and commands.
It requires `--ledger=STOPPED-SOURCE-LEDGER` (v7), compares accepted-input lifecycle
before cleanup, and rejects missing/corrupt retained bytes without removing anything.
Missing post-backup input requires a fresh stopped-source full DB/object capture;
see RESTORE_ACCEPTED_INPUTS.md. An older v6 ledger must be reexported from source.

Before any activation, reconcile authoritative deletion/revocation requests that
occurred **after** the backup, and execute all retention policies now elapsed,
including physical absence checks. A historical backup cannot know later privacy
requests. A complete automated reconciliation/release receipt is unfinished.
Restore must remain inaccessible until that gate is implemented and verified.
`PRIVACY_LEDGER.md` now documents encrypted source-ledger export, read-only
comparison and atomic original deletion/current-policy/historical retirement and
access-restriction replay. That partial reconciliation does not authorize release;
accepted-input comparison/recapture now guards cleanup, but final source cutoff,
full business-state parity and activation remain unfinished.
SOURCE_CUTOFF.md now documents a read-only complete source-snapshot observation:
every table, sequence, guard definition and known private reference is compared
and verified. A matching observation does not fence later source writes or
authorize target activation. Keep the source stopped and preserve all evidence.

Recreate restricted runtime roles and secret configuration, rotate compromised
credentials/keys, verify private bucket/CORS/TLS/region restrictions, and complete
incident/rollback/customer-communication approval. Restored provider policies and
historical connection-test results do not authorize new provider dispatch. Gemini
free tier remains synthetic-only, with no real worker audio/responses sent.

RUNTIME_PERMISSIONS.md now documents executable dedicated service-role setup,
hosted startup rejection of unsafe credentials and persistent ACL source fencing
for every explicitly listed API/worker role. It is not an immutable backup-bound
cutoff or target release receipt. Maintenance owners/direct storage writers must
remain stopped; target permission recreation and native/cloud proof remain gates.

RESTORE_STATE_ACCOUNTING.md documents the new mandatory locked baseline recheck
inside production quarantine, whole post-quarantine inventory and encrypted
target-bound checkpoint. Unexpected deferred side effects roll back, and final
post-copy inventory drift prevents success. Later replay/cleanup state-chain
accounting and release remain incomplete; quarantine-state.enc alone is not a
completed restore or activation receipt.

## Evidence

`tests/postgres-backup.test.mjs` exercises authenticated encrypted files, native
command timeout/error redaction, full inventory, writer/lease/heartbeat gates,
audit rollback, all six private object families, missing/corrupt object failure,
and an isolated **physical PGlite database archive** round trip with object
readback and interruption. Immutable publication/assignment guards survive. Its
transport replaces the native utility with the embedded physical archive and
does not prove native `pg_dump`/`pg_restore`, parallel PostgreSQL or Neon behavior.

`tests/postgres-backup-native.test.mjs` executes the actual native utilities only
when explicitly supplied `UNDERSTOOD_BACKUP_TEST_ISOLATED=true`, dedicated
`UNDERSTOOD_BACKUP_TEST_SOURCE_URL` and an empty
`UNDERSTOOD_BACKUP_TEST_RESTORE_URL`. Remote fixtures also require
`UNDERSTOOD_BACKUP_TEST_TLS=true` and `UNDERSTOOD_BACKUP_TEST_CA_FILE`. It creates
only a random `understood_test_backup_*` schema, verifies relations/private audio,
and removes only its owned successful fixture schemas. A failed target remains
isolated for inspection. Missing prerequisites are an explicit skip, not a pass.
R2 calls are mocked in local coverage; no cloud operation is implied.
