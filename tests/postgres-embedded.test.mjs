import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../server/postgres/migrate.mjs';

function embeddedPool(db) {
  const client = {
    async query(sql, values) {
      if (values?.length) return db.query(sql, values);
      const results = await db.exec(sql);
      return results.at(-1) ?? { rows: [] };
    },
    release() {},
  };
  return { async connect() { return client; } };
}

test('embedded PostgreSQL executes migration and protects tenant, site, receipt and snapshots', async () => {
  const db = new PGlite();
  const pool = embeddedPool(db);
  try {
    assert.deepEqual(await runMigrations(pool), [
      '001_initial.sql', '002_submission_receipts.sql', '003_exports_imports.sql', '004_audit_read_only.sql', '005_typed_assessment.sql',
      '006_preparation_leases.sql', '007_assignment_language.sql', '008_clarification_evidence.sql', '009_publication_withdrawals.sql', '010_directory_reactivations.sql',
      '011_briefing_copies.sql', '012_briefing_archives.sql', '013_manual_invoices.sql', '014_invoice_voids.sql', '015_workspace_settings.sql',
      '016_draft_reviews.sql', '017_templates.sql', '018_glossary.sql', '019_staff_access.sql', '020_account_recovery.sql',
      '021_staff_accounts.sql', '022_staff_invitations.sql', '023_generated_audio.sql', '024_target_regeneration.sql', '025_preparation_progress.sql',
      '026_audio_retention.sql', '027_worker_deletion_requests.sql', '028_deletion_exports.sql', '029_deletion_imports.sql', '030_deletion_redactions.sql',
      '031_deletion_reactivation_labels.sql', '032_deletion_import_metadata.sql', '033_worker_pseudonyms.sql', '034_deletion_completions.sql', '035_recording_notices.sql',
      '036_notification_reads.sql', '037_publication_schedules.sql', '038_assignment_reminders.sql', '039_draft_creations.sql', '040_generation_languages.sql',
      '041_draft_generation_languages.sql', '042_site_contacts.sql', '043_source_audio.sql', '044_source_audio_cleanup.sql', '045_source_audio_retries.sql',
      '046_draft_language_requests.sql', '047_pilot_inquiries.sql', '048_site_onboarding.sql', '049_platform_operations.sql', '050_worker_health.sql',
      '051_provider_controls.sql', '052_storage_health.sql', '053_workspace_bootstrap.sql', '054_site_creations.sql', '055_site_access.sql',
      '056_site_lifecycle.sql', '057_case_routing.sql', '058_case_messages.sql', '059_case_followups.sql', '060_case_repeats.sql',
      '061_case_reviews.sql', '062_case_voice.sql', '063_recording_provider.sql', '064_preparation_provider.sql', '065_assessment_provider.sql',
      '066_provider_stage_tests.sql', '067_audio_provider_provenance.sql', '068_followup_provider_provenance.sql', '069_preparation_provider_provenance.sql',
      '070_response_text_retention.sql', '071_resolved_case_retention.sql', '072_generated_audio_retention.sql', '073_restore_privacy_retirements.sql',
      '074_restore_access_restrictions.sql', '075_report_scopes.sql', '076_usage_requests.sql', '077_activity_retention.sql', '078_operational_audit_receipts.sql',
      '079_archived_briefing_content_retention.sql', '080_restore_activity_redactions.sql',
      '081_briefing_expiry_origins.sql',
      '082_restore_briefing_redactions.sql',
      '083_restore_cleanup_transitions.sql',
      '084_export_retry_receipts.sql', '085_preparation_request_receipts.sql', '086_processing_retry_receipts.sql', '087_neon_storage_health.sql', '088_operator_column_boundary.sql', '089_provider_verification_authorities.sql', '090_provider_verification_jobs.sql', '091_provider_verification_workers.sql', '092_worker_identity_locks.sql', '093_clarification_action_receipts.sql',
      '094_staff_clarification_creations.sql', '095_staff_inperson_recordings.sql',
      '096_instruction_modes_and_acknowledgments.sql',
      '097_worker_language_identity.sql',
      '098_worker_password_credentials.sql',
      '099_worker_language_locales.sql',
      '100_presentation_artifacts.sql',
      '101_presentation_retention.sql',
      '102_recording_presentation_guard.sql',
      '103_instruction_deliveries.sql',
      '104_instruction_content_retention.sql',
      '105_organization_entitlements.sql',
      '106_owner_registration.sql',
      '107_first_run_onboarding.sql',
      '108_notification_events.sql',
    ]);
    assert.deepEqual(await runMigrations(pool), []);
    await db.query("INSERT INTO organizations(id,name) VALUES ('org-a','A'),('org-b','B')");
    await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('site-a','org-a','A','UTC'),('site-c','org-a','C','UTC'),('site-b','org-b','B','UTC')");
    await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('worker-a','org-a','site-a','001','en'),('worker-c','org-a','site-c','002','en'),('worker-b','org-b','site-b','001','en')");
    await db.query("INSERT INTO crews(id,org_id,site_id,name) VALUES ('crew-a','org-a','site-a','Morning')");
    await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('staff-a','org-a','site-a','Owner','owner'),('staff-b','org-b','site-b','Owner','owner')");
    await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES ('brief-a','org-a','site-a','Brief','Source','ready')");
    await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES ('pub-a','org-a','site-a','brief-a',1,'{}','published')");
    await db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('assignment-a','org-a','site-a','pub-a','worker-a','en')");
    await db.query("INSERT INTO worker_grants(id,org_id,site_id,worker_id,token_hash,expires_at) VALUES ('grant-a','org-a','site-a','worker-a',$1,now()+interval '1 hour')", ['a'.repeat(64)]);

    await assert.rejects(db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('forged','org-a','site-a','pub-a','worker-b','en')"), /foreign key/i);
    await assert.rejects(db.query("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES ('forged-site','org-a','site-a','pub-a','worker-c','en')"), /foreign key/i);
    await assert.rejects(db.query("INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id) VALUES ('worker-c','org-a','site-c','crew-a')"), /foreign key/i);
    await assert.rejects(db.query(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,grant_id,access_mode)
      VALUES ($1,'org-a','site-c','worker','worker-c',now()+interval '1 hour','grant-a','credential')`, ['b'.repeat(64)]), /foreign key/i);
    await assert.rejects(db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status)
      VALUES ('recording-a','org-a','site-a','assignment-a','submission-a',$1,1,100,'received')`, ['c'.repeat(64)]), /check constraint/i);
    await db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status)
      VALUES ('recording-a','org-a','site-a','assignment-a','submission-a',$1,1,100,'storing')`, ['c'.repeat(64)]);
    await db.query("UPDATE recordings SET status='received',received_at=now() WHERE id='recording-a'");
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM recordings WHERE received_at IS NOT NULL")).rows[0].n, 1);
    await db.query(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json)
      VALUES ('attempt-a','org-a','site-a','assignment-a','typed-a','blue shelf','matched','[]')`);
    const timestamp = '2026-10-02T09:18:00Z';
    await db.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ('org-a','assignment-a','typed-a','typed',$1)`, [timestamp]);
    await db.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ('org-a','assignment-a','submission-a','audio',$1)`, [timestamp]);
    const receipts = (await db.query(`SELECT sequence,submission_id,kind,received_at FROM submission_receipts
      WHERE assignment_id='assignment-a' ORDER BY sequence`)).rows;
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].kind, 'typed');
    assert.equal(receipts[1].kind, 'audio');
    assert.equal(receipts[0].received_at.getTime(), receipts[1].received_at.getTime());
    assert.ok(BigInt(receipts[1].sequence) > BigInt(receipts[0].sequence));
    assert.equal((await db.query(`SELECT submission_id FROM submission_receipts
      WHERE assignment_id='assignment-a' ORDER BY sequence DESC LIMIT 1`)).rows[0].submission_id, 'submission-a');
    await assert.rejects(db.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ('org-b','assignment-a','forged','audio',now())`), /foreign key/i);
    await assert.rejects(db.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ('org-a','assignment-a','typed-a','audio',now())`), /unique constraint/i);
    await assert.rejects(db.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ('org-a','assignment-a','invalid-kind','other',now())`), /check constraint/i);
    await assert.rejects(db.query("UPDATE submission_receipts SET received_at=now() WHERE submission_id='typed-a'"), /Receipt is immutable/);
    await assert.rejects(db.query("UPDATE publications SET snapshot_json='{\"changed\":true}' WHERE id='pub-a'"), /Published snapshot is immutable/);
    await assert.rejects(db.query("UPDATE assignments SET worker_id='worker-c' WHERE id='assignment-a'"), /Assignment snapshot is immutable/);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM assignments')).rows[0].n, 1);

    await assert.rejects(db.query(`INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,created_at,expires_at,status,snapshot_json)
      VALUES ('forged-export','org-a','site-a','pub-a','staff-b',now(),now()+interval '1 hour','queued','[]')`), /foreign key/i);
    await db.query(`INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,created_at,expires_at,status,snapshot_json)
      VALUES ('export-a','org-a','site-a','pub-a','staff-a',now(),now()+interval '1 hour','queued','[]')`);
    await assert.rejects(db.query("UPDATE report_exports SET snapshot_json='[[1]]' WHERE id='export-a'"), /immutable/i);
    await assert.rejects(db.query("UPDATE report_exports SET status='expired',snapshot_json=NULL WHERE id='export-a'"), /immutable/i);
    await assert.rejects(db.query("UPDATE report_exports SET status='ready' WHERE id='export-a'"), /check constraint/i);
    await db.query(`INSERT INTO worker_imports(id,org_id,site_id,requested_by,filename,sha256,status,rows_json,errors_json,created_at,expires_at)
      VALUES ('import-a','org-a','site-a','staff-a','crew.csv',$1,'validated','[]','[]',now(),now()+interval '1 hour')`, ['d'.repeat(64)]);
    await assert.rejects(db.query("UPDATE worker_imports SET requested_by='staff-b' WHERE id='import-a'"), /immutable/i);
    await assert.rejects(db.query("UPDATE worker_imports SET rows_json='[[1]]' WHERE id='import-a'"), /immutable/i);
    await db.query("INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id) VALUES ('event-a','org-a','site-a','staff','staff-a','test.created','pub-a')");
    await assert.rejects(db.query("UPDATE audit SET action='forged' WHERE id='event-a'"), /read-only/i);
    await assert.rejects(db.query("DELETE FROM audit WHERE id='event-a'"), /read-only/i);

    await db.query("UPDATE schema_migrations SET checksum='changed' WHERE version='001_initial.sql'");
    await assert.rejects(runMigrations(pool), /Migration checksum mismatch/);
  } finally {
    await db.close();
  }
});
