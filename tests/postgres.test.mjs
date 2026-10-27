import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPostgresPool, withTransaction } from '../server/postgres/db.mjs';
import { runMigrations,verifyMigrations } from '../server/postgres/migrate.mjs';

const migrationPath = fileURLToPath(new URL('../server/postgres/migrations/001_initial.sql', import.meta.url));
const receiptsMigrationPath = fileURLToPath(new URL('../server/postgres/migrations/002_submission_receipts.sql', import.meta.url));

function fakePool() {
  const commands = [], applied = new Map();
  let released = 0;
  const client = {
    async query(sql, params = []) {
      commands.push({ sql, params });
      if (sql.includes('FROM pg_namespace')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM schema_migrations')) return { rows: [...applied].map(([version, checksum]) => ({ version, checksum })) };
      if (sql.startsWith('INSERT INTO schema_migrations')) applied.set(params[0], params[1]);
      return { rows: [] };
    },
    release() { released++; },
  };
  return { commands, applied, client, get released() { return released; }, async connect() { return client; } };
}

test('initial schema declares tenant-safe references, immutable snapshots and private recording scope', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const table of ['organizations', 'sites', 'staff', 'workers', 'crews', 'crew_memberships', 'briefings', 'publications',
    'assignments', 'attempts', 'clarifications', 'jobs', 'worker_grants', 'sessions', 'recordings', 'audit']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(sql, /FOREIGN KEY \(worker_id, org_id, site_id\) REFERENCES workers\(id, org_id, site_id\)/);
  assert.match(sql, /FOREIGN KEY \(crew_id, org_id, site_id\) REFERENCES crews\(id, org_id, site_id\)/);
  assert.match(sql, /FOREIGN KEY \(assignment_id, org_id, site_id\) REFERENCES assignments\(id, org_id, site_id\)/);
  assert.match(sql, /FOREIGN KEY \(attempt_id, org_id, site_id, assignment_id\) REFERENCES attempts/);
  assert.match(sql, /publications_snapshot_immutable/);
  assert.match(sql, /assignments_snapshot_immutable/);
  assert.match(sql, /UNIQUE \(assignment_id, submission_id\)/);
  assert.match(sql, /received_at timestamptz/);
  assert.match(sql, /lease_token text/);
  assert.match(sql, /received_at IS NOT NULL OR status IN \('storing', 'failed'\)/);
  assert.match(sql, /FOREIGN KEY \(grant_id, org_id, site_id, principal_id\) REFERENCES worker_grants\(id, org_id, site_id, worker_id\)/);
  assert.match(sql, /CREATE TRIGGER sessions_scope/);
});

test('receipt migration binds assignment scope and freezes monotonic receipt records', async () => {
  const sql = await readFile(receiptsMigrationPath, 'utf8');
  assert.match(sql, /sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /FOREIGN KEY \(assignment_id, org_id\) REFERENCES assignments\(id, org_id\)/);
  assert.match(sql, /UNIQUE \(assignment_id, submission_id\)/);
  assert.match(sql, /CHECK \(kind IN \('typed', 'audio'\)\)/);
  assert.match(sql, /CREATE TRIGGER submission_receipts_frozen BEFORE UPDATE/);
});

test('migration runner applies once under a transaction and rejects checksum drift', async () => {
  const pool = fakePool();
  assert.deepEqual(await runMigrations(pool), ['001_initial.sql', '002_submission_receipts.sql', '003_exports_imports.sql', '004_audit_read_only.sql', '005_typed_assessment.sql', '006_preparation_leases.sql', '007_assignment_language.sql', '008_clarification_evidence.sql', '009_publication_withdrawals.sql', '010_directory_reactivations.sql', '011_briefing_copies.sql', '012_briefing_archives.sql', '013_manual_invoices.sql', '014_invoice_voids.sql', '015_workspace_settings.sql', '016_draft_reviews.sql', '017_templates.sql', '018_glossary.sql', '019_staff_access.sql', '020_account_recovery.sql', '021_staff_accounts.sql', '022_staff_invitations.sql', '023_generated_audio.sql', '024_target_regeneration.sql', '025_preparation_progress.sql', '026_audio_retention.sql', '027_worker_deletion_requests.sql', '028_deletion_exports.sql', '029_deletion_imports.sql', '030_deletion_redactions.sql', '031_deletion_reactivation_labels.sql', '032_deletion_import_metadata.sql', '033_worker_pseudonyms.sql', '034_deletion_completions.sql', '035_recording_notices.sql', '036_notification_reads.sql', '037_publication_schedules.sql', '038_assignment_reminders.sql', '039_draft_creations.sql', '040_generation_languages.sql', '041_draft_generation_languages.sql', '042_site_contacts.sql', '043_source_audio.sql', '044_source_audio_cleanup.sql', '045_source_audio_retries.sql', '046_draft_language_requests.sql', '047_pilot_inquiries.sql', '048_site_onboarding.sql', '049_platform_operations.sql', '050_worker_health.sql', '051_provider_controls.sql', '052_storage_health.sql', '053_workspace_bootstrap.sql', '054_site_creations.sql', '055_site_access.sql', '056_site_lifecycle.sql', '057_case_routing.sql', '058_case_messages.sql', '059_case_followups.sql', '060_case_repeats.sql', '061_case_reviews.sql', '062_case_voice.sql', '063_recording_provider.sql', '064_preparation_provider.sql', '065_assessment_provider.sql', '066_provider_stage_tests.sql', '067_audio_provider_provenance.sql', '068_followup_provider_provenance.sql', '069_preparation_provider_provenance.sql', '070_response_text_retention.sql', '071_resolved_case_retention.sql', '072_generated_audio_retention.sql', '073_restore_privacy_retirements.sql', '074_restore_access_restrictions.sql', '075_report_scopes.sql', '076_usage_requests.sql', '077_activity_retention.sql', '078_operational_audit_receipts.sql', '079_archived_briefing_content_retention.sql', '080_restore_activity_redactions.sql', '081_briefing_expiry_origins.sql', '082_restore_briefing_redactions.sql', '083_restore_cleanup_transitions.sql', '084_export_retry_receipts.sql', '085_preparation_request_receipts.sql', '086_processing_retry_receipts.sql', '087_neon_storage_health.sql', '088_operator_column_boundary.sql', '089_provider_verification_authorities.sql', '090_provider_verification_jobs.sql', '091_provider_verification_workers.sql', '092_worker_identity_locks.sql', '093_clarification_action_receipts.sql', '094_staff_clarification_creations.sql', '095_staff_inperson_recordings.sql', '096_instruction_modes_and_acknowledgments.sql','097_worker_language_identity.sql','098_worker_password_credentials.sql','099_worker_language_locales.sql','100_presentation_artifacts.sql','101_presentation_retention.sql','102_recording_presentation_guard.sql','103_instruction_deliveries.sql','104_instruction_content_retention.sql','105_organization_entitlements.sql','106_owner_registration.sql','107_first_run_onboarding.sql','108_notification_events.sql','109_generation_language_locales.sql','110_presentation_choices_and_preparation_budget.sql','111_production_provider_evidence.sql','112_presentation_translation_jobs.sql','113_briefing_language_requests.sql']);
  assert.equal(pool.released, 1);
  assert.ok(pool.commands.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));
  assert.ok(pool.commands.some(({ sql }) => sql.includes('CREATE TABLE organizations')));
  assert.ok(pool.commands.some(({ sql }) => sql.includes('CREATE TABLE submission_receipts')));
  assert.equal(pool.commands.at(-1).sql, 'COMMIT');
  assert.deepEqual(await runMigrations(pool), []);
  assert.equal(pool.commands.filter(({ sql }) => sql.includes('CREATE TABLE organizations')).length, 1);
  pool.applied.set('001_initial.sql', 'bad checksum');
  await assert.rejects(runMigrations(pool), /Migration checksum mismatch/);
  assert.equal(pool.commands.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.released, 3);
});

test('transaction helper rolls back and releases a failed client', async () => {
  const pool = fakePool();
  await assert.rejects(withTransaction(pool, () => { throw new Error('failed write'); }), /failed write/);
  assert.deepEqual(pool.commands.map(({ sql }) => sql), ['BEGIN', 'ROLLBACK']);
  assert.equal(pool.released, 1);
});

test('runtime schema verification is read-only and rejects missing, extra or changed migrations',async () => {
  const pool=fakePool();
  await assert.rejects(verifyMigrations(pool),/not current/);
  await runMigrations(pool);
  pool.commands.length=0;
  assert.deepEqual(await verifyMigrations(pool),{schema:'public',migrations:113});
  assert.ok(pool.commands.some(({sql}) => sql==='SET TRANSACTION READ ONLY'));
  assert.ok(pool.commands.every(({sql}) => !/CREATE|ALTER|INSERT|UPDATE|DELETE/.test(sql)));
  pool.applied.set('999_future.sql','unexpected');
  await assert.rejects(verifyMigrations(pool),/not current/);
  pool.applied.delete('999_future.sql');pool.applied.set('001_initial.sql','modified');
  await assert.rejects(verifyMigrations(pool),/verification failed/);
  assert.equal(pool.commands.at(-1).sql,'ROLLBACK');
});

test('pool configuration rejects missing or non-TLS remote URLs before loading pg', async () => {
  await assert.rejects(createPostgresPool({ connectionString: '' }), /UNDERSTOOD_POSTGRES_URL/);
  await assert.rejects(createPostgresPool({ connectionString: 'postgresql:\/\/remote.example\/understood', tls: false }), /TLS is required/);
  const pool = await createPostgresPool({ connectionString: 'postgresql://user:pass@127.0.0.1:5432/understood_test', tls: false });
  assert.equal(typeof pool.query, 'function');
  await pool.end();
});
