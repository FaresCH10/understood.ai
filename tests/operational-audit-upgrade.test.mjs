import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';

test('operational receipt upgrade preserves exact present evidence, never reconstructs expired identities and captures atomically',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'understood-operational-upgrade-')),db=new PGlite();
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  try{
    const source=new URL('../server/postgres/migrations/',import.meta.url);
    for(const name of await readdir(source))if(/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name<'078_')await copyFile(new URL(name,source),join(directory,name));
    await runMigrations(pool,{directory});
    await db.exec(`INSERT INTO organizations VALUES('org','Synthetic');INSERT INTO sites VALUES('site','org','Synthetic','UTC');
      INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES
        ('present','org','site','staff','owner','worker.disabled','worker',clock_timestamp()-interval '40 days'),
        ('expired','org','site','staff','owner','credential.recovered','account',clock_timestamp()-interval '40 days'),
        ('ordinary','org','site','staff','owner','answer.received','answer',clock_timestamp()-interval '40 days');
      INSERT INTO activity_retention_policies VALUES('site','org',1,30,clock_timestamp());
      BEGIN;INSERT INTO activity_identity_purges(event_id,org_id,site_id,policy_revision,days) VALUES('expired','org','site',1,30);
        UPDATE audit SET actor_id='',object_id='' WHERE id='expired';COMMIT;`);
    const present=(await db.query("SELECT * FROM audit WHERE id='present'")).rows[0];
    assert.deepEqual(await runMigrations(pool),['078_operational_audit_receipts.sql','079_archived_briefing_content_retention.sql','080_restore_activity_redactions.sql','081_briefing_expiry_origins.sql','082_restore_briefing_redactions.sql','083_restore_cleanup_transitions.sql','084_export_retry_receipts.sql', '085_preparation_request_receipts.sql', '086_processing_retry_receipts.sql', '087_neon_storage_health.sql', '088_operator_column_boundary.sql', '089_provider_verification_authorities.sql', '090_provider_verification_jobs.sql', '091_provider_verification_workers.sql', '092_worker_identity_locks.sql', '093_clarification_action_receipts.sql', '094_staff_clarification_creations.sql', '095_staff_inperson_recordings.sql','096_instruction_modes_and_acknowledgments.sql','097_worker_language_identity.sql','098_worker_password_credentials.sql','099_worker_language_locales.sql','100_presentation_artifacts.sql','101_presentation_retention.sql','102_recording_presentation_guard.sql','103_instruction_deliveries.sql','104_instruction_content_retention.sql','105_organization_entitlements.sql','106_owner_registration.sql','107_first_run_onboarding.sql','108_notification_events.sql','109_generation_language_locales.sql','110_presentation_choices_and_preparation_budget.sql','111_production_provider_evidence.sql','112_presentation_translation_jobs.sql','113_briefing_language_requests.sql']);
    assert.deepEqual((await db.query('SELECT * FROM operational_audit_receipts')).rows,[present]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM operational_audit_receipts WHERE id IN ('expired','ordinary')")).rows[0].n,0);
    await db.exec("INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id) VALUES('new','org','site','system','restore-operator','backup.restore.privacy.policies','synthetic-marker')");
    assert.deepEqual((await db.query("SELECT * FROM operational_audit_receipts WHERE id='new'")).rows,(await db.query("SELECT * FROM audit WHERE id='new'")).rows);
    await db.exec(`CREATE FUNCTION reject_operational_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected receipt failure';END $$;
      CREATE TRIGGER reject_operational_fixture BEFORE INSERT ON operational_audit_receipts FOR EACH ROW EXECUTE FUNCTION reject_operational_fixture();`);
    await assert.rejects(db.exec("INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id) VALUES('failed','org','site','staff','owner','worker.disabled','worker')"),/Injected receipt failure/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM audit WHERE id='failed'")).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM operational_audit_receipts WHERE id='failed'")).rows[0].n,0);
  }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
