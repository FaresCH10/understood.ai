import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {saveBriefingRetention,processOneBriefingContentPurge} from '../server/postgres/briefing-retention.mjs';

test('expiry-origin upgrade never reconstructs an older erased source or permits retrospective SQL capture',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'understood-briefing-upgrade-')),db=new PGlite();
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  try{
    const source=new URL('../server/postgres/migrations/',import.meta.url);
    for(const name of await readdir(source))if(/^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name<'081_')await copyFile(new URL(name,source),join(directory,name));
    await runMigrations(pool,{directory});
    await db.exec(`INSERT INTO organizations VALUES('org','Synthetic');INSERT INTO sites VALUES('site','org','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Owner','owner');
      INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('old','org','site','PRIVATE title','PRIVATE source','ready');
      INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at)
        VALUES('archive','org','site','old','{}','[]','owner',clock_timestamp()-interval '10 days');`);
    await saveBriefingRetention(pool,{principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'},
      {requestId:randomUUID(),revision:0,days:7,confirmed:true});
    assert.equal(await processOneBriefingContentPurge(pool),true);
    const original=(await db.query('SELECT * FROM briefing_content_purges')).rows[0];
    assert.deepEqual(await runMigrations(pool),['081_briefing_expiry_origins.sql','082_restore_briefing_redactions.sql','083_restore_cleanup_transitions.sql','084_export_retry_receipts.sql', '085_preparation_request_receipts.sql', '086_processing_retry_receipts.sql', '087_neon_storage_health.sql', '088_operator_column_boundary.sql', '089_provider_verification_authorities.sql', '090_provider_verification_jobs.sql', '091_provider_verification_workers.sql', '092_worker_identity_locks.sql', '093_clarification_action_receipts.sql', '094_staff_clarification_creations.sql', '095_staff_inperson_recordings.sql','096_instruction_modes_and_acknowledgments.sql','097_worker_language_identity.sql','098_worker_password_credentials.sql','099_worker_language_locales.sql','100_presentation_artifacts.sql','101_presentation_retention.sql','102_recording_presentation_guard.sql','103_instruction_deliveries.sql','104_instruction_content_retention.sql','105_organization_entitlements.sql','106_owner_registration.sql','107_first_run_onboarding.sql','108_notification_events.sql']);
    assert.deepEqual((await db.query('SELECT * FROM briefing_content_purges')).rows[0],original);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM briefing_content_origins')).rows[0].n,0);
    await assert.rejects(db.exec(`INSERT INTO briefing_content_origins(briefing_id,org_id,site_id,context_json,source_receipt_json,source_policy_json)
      SELECT p.briefing_id,p.org_id,p.site_id,briefing_expiry_context(p.briefing_id,p.org_id,p.site_id),to_jsonb(p),to_jsonb(r)
      FROM briefing_content_purges p JOIN briefing_retention_requests r ON r.org_id=p.org_id AND r.site_id=p.site_id AND r.revision=p.policy_revision`),/Original briefing expiry context/);
    assert.equal((await db.query('SELECT source FROM briefings')).rows[0].source,'[Expired]');
  }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
