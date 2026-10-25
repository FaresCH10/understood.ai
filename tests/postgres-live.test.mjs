import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPostgresPool, withTransaction } from '../server/postgres/db.mjs';
import { runMigrations } from '../server/postgres/migrate.mjs';

const connectionString = process.env.UNDERSTOOD_PG_TEST_URL;
const target = connectionString ? new URL(connectionString) : null;
const allowed = target && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname) &&
  /test/i.test(decodeURIComponent(target.pathname));

test('real PostgreSQL migration enforces scope and immutable publication', { skip: !allowed }, async () => {
  const pool = await createPostgresPool({ connectionString, tls: false });
  const schema = `understood_test_${randomBytes(5).toString('hex')}`;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
assert.deepEqual(await runMigrations(pool, { schema }), ['001_initial.sql', '002_submission_receipts.sql', '003_exports_imports.sql', '004_audit_read_only.sql', '005_typed_assessment.sql', '006_preparation_leases.sql', '007_assignment_language.sql', '008_clarification_evidence.sql', '009_publication_withdrawals.sql', '010_directory_reactivations.sql', '011_briefing_copies.sql', '012_briefing_archives.sql', '013_manual_invoices.sql', '014_invoice_voids.sql', '015_workspace_settings.sql', '016_draft_reviews.sql', '017_templates.sql', '018_glossary.sql', '019_staff_access.sql', '020_account_recovery.sql', '021_staff_accounts.sql', '022_staff_invitations.sql', '023_generated_audio.sql', '024_target_regeneration.sql', '025_preparation_progress.sql', '026_audio_retention.sql', '027_worker_deletion_requests.sql', '028_deletion_exports.sql', '029_deletion_imports.sql', '030_deletion_redactions.sql', '031_deletion_reactivation_labels.sql', '032_deletion_import_metadata.sql', '033_worker_pseudonyms.sql', '034_deletion_completions.sql', '035_recording_notices.sql', '036_notification_reads.sql', '037_publication_schedules.sql', '038_assignment_reminders.sql', '039_draft_creations.sql', '040_generation_languages.sql', '041_draft_generation_languages.sql', '042_site_contacts.sql', '043_source_audio.sql', '044_source_audio_cleanup.sql', '045_source_audio_retries.sql', '046_draft_language_requests.sql', '047_pilot_inquiries.sql', '048_site_onboarding.sql', '049_platform_operations.sql', '050_worker_health.sql', '051_provider_controls.sql', '052_storage_health.sql', '053_workspace_bootstrap.sql', '054_site_creations.sql', '055_site_access.sql', '056_site_lifecycle.sql', '057_case_routing.sql', '058_case_messages.sql', '059_case_followups.sql', '060_case_repeats.sql', '061_case_reviews.sql', '062_case_voice.sql', '063_recording_provider.sql', '064_preparation_provider.sql', '065_assessment_provider.sql', '066_provider_stage_tests.sql', '067_audio_provider_provenance.sql', '068_followup_provider_provenance.sql', '069_preparation_provider_provenance.sql', '070_response_text_retention.sql', '071_resolved_case_retention.sql', '072_generated_audio_retention.sql', '073_restore_privacy_retirements.sql', '074_restore_access_restrictions.sql', '075_report_scopes.sql', '076_usage_requests.sql', '077_activity_retention.sql', '078_operational_audit_receipts.sql', '079_archived_briefing_content_retention.sql', '080_restore_activity_redactions.sql', '081_briefing_expiry_origins.sql', '082_restore_briefing_redactions.sql', '083_restore_cleanup_transitions.sql', '084_export_retry_receipts.sql', '085_preparation_request_receipts.sql', '086_processing_retry_receipts.sql', '087_neon_storage_health.sql', '088_operator_column_boundary.sql', '089_provider_verification_authorities.sql', '090_provider_verification_jobs.sql', '091_provider_verification_workers.sql', '092_worker_identity_locks.sql', '093_clarification_action_receipts.sql', '094_staff_clarification_creations.sql', '095_staff_inperson_recordings.sql', '096_instruction_modes_and_acknowledgments.sql','097_worker_language_identity.sql','098_worker_password_credentials.sql','099_worker_language_locales.sql','100_presentation_artifacts.sql','101_presentation_retention.sql','102_recording_presentation_guard.sql','103_instruction_deliveries.sql','104_instruction_content_retention.sql','105_organization_entitlements.sql','106_owner_registration.sql','107_first_run_onboarding.sql','108_notification_events.sql']);
    assert.deepEqual(await runMigrations(pool, { schema }), []);
    await withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B')");
      await client.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('site-a','org-a','A','UTC'),('site-c','org-a','C','UTC'),('site-b','org-b','B','UTC')");
      await client.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('worker-a','org-a','site-a','001','en'),('worker-c','org-a','site-c','002','en'),('worker-b','org-b','site-b','001','en')");
      await client.query("INSERT INTO crews(id,org_id,site_id,name) VALUES ('crew-a','org-a','site-a','Morning')");
      await client.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES ('brief-a','org-a','site-a','Brief','Source','ready')");
      await client.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES ('pub-a','org-a','site-a','brief-a',1,'{}','published')");
      await client.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('assignment-a','org-a','site-a','pub-a','worker-a','en')");
      await client.query("INSERT INTO worker_grants(id,org_id,site_id,worker_id,token_hash,expires_at) VALUES ('grant-a','org-a','site-a','worker-a',$1,now()+interval '1 hour')", ['a'.repeat(64)]);
    });
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('forged','org-a','site-a','pub-a','worker-b','en')");
    }), (error) => error.code === '23503');
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('forged-site','org-a','site-a','pub-a','worker-c','en')");
    }), (error) => error.code === '23503');
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query("INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id) VALUES ('worker-c','org-a','site-c','crew-a')");
    }), (error) => error.code === '23503');
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query('INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,grant_id,access_mode) VALUES ($1,$2,$3,$4,$5,now()+interval \'1 hour\',$6,$7)',
        ['b'.repeat(64), 'org-a', 'site-c', 'worker', 'worker-c', 'grant-a', 'credential']);
    }), (error) => error.code === '23503');
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query('INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['recording-a', 'org-a', 'site-a', 'assignment-a', 'submission-a', 'c'.repeat(64), 1, 100, 'received']);
    }), (error) => error.code === '23514');
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES ('org-b','assignment-a','forged','audio',now())");
    }), (error) => error.code === '23503');
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
      await client.query("UPDATE publications SET snapshot_json='{\"changed\":true}' WHERE id='pub-a'");
    }), /Published snapshot is immutable/);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
