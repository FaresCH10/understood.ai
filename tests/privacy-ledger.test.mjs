import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {fixtureState,retryState} from './restore-state-fixture.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {withTransaction} from '../server/postgres/db.mjs';
import {databaseInventory,privateObjectInventory,quarantineRestoredDatabase} from '../server/postgres/backup.mjs';
import {exportPrivacyLedger,validatePrivacyLedger,privacyLedgerFingerprint,planPrivacyReconciliation,replayPrivacyDeletions,replayPrivacyPolicies,replayPrivacyActivity,replayPrivacyBriefings} from '../server/postgres/privacy-ledger.mjs';
import {createPrivacyLedgerExport,inspectPrivacyRestore,replayPrivacyRestoreDeletions,replayPrivacyRestorePolicies,replayPrivacyRestoreActivity,replayPrivacyRestoreBriefings} from '../scripts/postgres-privacy.mjs';
import {backupKey,createPrivateDirectory,writeBackupCompletion,readBackupCompletion,decryptBackupBytes,encryptBackupBytes} from '../server/backup-files.mjs';
import {restoreStateHash} from '../server/postgres/restore-replay-state.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {saveRetention,processOneAudioPurge} from '../server/postgres/retention.mjs';
import {saveTextRetention} from '../server/postgres/text-retention.mjs';
import {saveCaseRetention} from '../server/postgres/case-retention.mjs';
import {saveGeneratedRetention} from '../server/postgres/generated-retention.mjs';
import {saveActivityRetention,processOneActivityPurge} from '../server/postgres/activity-retention.mjs';
import {saveBriefingRetention,processOneBriefingContentPurge} from '../server/postgres/briefing-retention.mjs';
import {processOneDeletionRedaction} from '../server/postgres/deletion-redactions.mjs';
import {processOneDeletionPseudonym} from '../server/postgres/deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from '../server/postgres/deletion-completions.mjs';

const schema='privacy_test',hash=value=>createHash('sha256').update(value).digest('hex');
const connection={connectionString:'postgresql://operator:private@127.0.0.1/source'},sourceIdentitySha256=hash('127.0.0.1:5432/source');
const session={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
const inventory=f=>withTransaction(f.pool,async client=>({database:await databaseInventory(client,schema),objects:await privateObjectInventory(client)}));
function poolFor(db){let failure='',snapshots=0;return {async connect(){return {async query(sql,args){
  if(failure && sql.includes(failure))throw Error('Injected private failure');
  if(sql==='SELECT pg_export_snapshot() AS id'){snapshots++;return {rows:[{id:'00000001-00000001-1'}]};}
  return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};
},release(){}};},fail(value){failure=value;},get snapshots(){return snapshots;}};}
async function fixture({retiredPublication=false,staffVoice=false,voiceLanguage='ur'}={}){
  const db=new PGlite(),pool=poolFor(db),root=await mkdtemp(join(tmpdir(),'understood-privacy-ledger-'));
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('org','SECRET_ORGANIZATION_LABEL');INSERT INTO sites VALUES('site','org','SECRET_SITE_LABEL','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','SECRET_STAFF_NAME','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','org','site','SECRET_WORKER_LABEL','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','org','site','SECRET_TITLE','SECRET_SOURCE','ready'),('retired-brief','org','site','SECRET_RETIRED_TITLE','SECRET_RETIRED_SOURCE','ready');
    INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES('old-activity','org','site','staff','owner','Synthetic old action','SECRET_ACTIVITY_ITEM',clock_timestamp()-interval '10 days');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','org','site','brief',1,'{"body":"SECRET_PUBLICATION","facts":["blue","yellow"]}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org','site','pub','worker','en');
    INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,evidence_json,assessment_status)
      VALUES('answer','org','site','assignment','typed','SECRET_ANSWER','matched','["SECRET_REASON"]','[]','complete');
    INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true);
    CREATE TABLE "future""evidence"(id text PRIMARY KEY,payload jsonb);INSERT INTO "future""evidence" VALUES('future','{"preserved":true}');`);
  const recordingId=randomUUID();
  await db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,received_at,transcript)
    VALUES($1,'org','site','assignment','recorded',$2,1,100,'received',clock_timestamp(),'SECRET_TRANSCRIPT')`,[recordingId,'a'.repeat(64)]);
  await saveRetention(pool,session,{requestId:randomUUID(),revision:0,audioDays:30,confirmed:true},{schema});
  if(staffVoice){
    await db.exec("INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status) VALUES('staff-case','org','site','assignment','Staff follow-up','open')");
    await db.query(`INSERT INTO case_voice(id,request_id,org_id,site_id,assignment_id,worker_id,kind,requested_case_id,language,sha256,bytes,duration_seconds,status,lease_token,lease_until,actor_type,actor_id,actor_role)
      VALUES($1,$2,'org','site','assignment','worker','in_person','staff-case','${voiceLanguage}',$3,32044,1,'storing',$4,clock_timestamp()+interval '120 seconds','staff','owner','owner')`,[randomUUID(),randomUUID(),'d'.repeat(64),randomUUID()]);
    await db.exec("UPDATE case_voice SET status='received',case_id=requested_case_id,received_at=clock_timestamp(),lease_token=NULL,lease_until=NULL");
  }
  if(retiredPublication)await db.exec(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state)
    VALUES('retired-pub','org','site','retired-brief',1,'{"body":"SECRET_RETIRED_PUBLICATION"}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language,due_at)
      VALUES('retired-assignment','org','site','retired-pub','worker','en',clock_timestamp()+interval '1 day');
    INSERT INTO draft_reviews VALUES('retired-brief','org','site','{"facts":["SECRET_REVIEW"]}');`);
  const original=await inventory({pool}),baseline={format:'understood-postgres-private-backup-v1',id:randomUUID(),createdAt:new Date().toISOString(),schema,toolVersion:16,
    sourceIdentitySha256,...original,archive:{name:'database.enc',bytes:100,sha256:'b'.repeat(64)},files:original.objects.map((row,index)=>({index,name:`object-${index}.enc`,bytes:row.bytes+36,sha256:'c'.repeat(64)}))};
  // Physical embedded copy pins the older database state; native utilities are not involved.
  const target=new PGlite({loadDataDir:await db.dumpDataDir('none')}),targetPool=poolFor(target);
  await target.exec(`SET search_path TO ${schema},pg_catalog`);
  return {db,pool,root,baseline,recordingId,target,targetPool,options:{schema,sourceIdentitySha256,writersStopped:true},
    async quarantine(){return quarantineRestoredDatabase(targetPool,{schema,backupId:baseline.id});},
    async laterPrivacy(){
      await db.exec(`INSERT INTO staff(id,org_id,site_id,name,role) VALUES('later-owner','org','site','SECRET_LATER_NAME','owner');
        INSERT INTO workers(id,org_id,site_id,code,language) VALUES('later-worker','org','site','SECRET_LATER_WORKER','en');`);
      const requestId=randomUUID();
      await requestWorkerDeletion(pool,{...session,principal_id:'later-owner'},'worker',{requestId,expectedCode:'SECRET_WORKER_LABEL',reason:'worker_request',confirmed:true},{schema});
      await requestWorkerDeletion(pool,session,'later-worker',{requestId:randomUUID(),expectedCode:'SECRET_LATER_WORKER',reason:'worker_request',confirmed:true},{schema});
      await saveRetention(pool,session,{requestId:randomUUID(),revision:1,audioDays:7,confirmed:true},{schema});
      await saveTextRetention(pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
      return requestId;
    },
    async close(){await target.close();await db.close();await rm(root,{recursive:true,force:true});}};
}

test('privacy ledger v8 binds private staff audio to its historical author without exporting audio or staff labels',async()=>{
  const f=await fixture({staffVoice:true});try{
    await f.db.exec("UPDATE staff SET role='auditor',active=false WHERE id='owner'");
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options),voice=ledger.tables.case_voice[0];
    assert.equal(voice.actor_type,'staff');assert.equal(voice.actor_id,'owner');assert.equal(voice.actor_role,'owner');assert.equal(voice.kind,'in_person');
    assert.doesNotMatch(JSON.stringify(ledger),/SECRET_|audioUrl|storageKey/);validatePrivacyLedger(ledger,f.baseline);
    for(const change of [{actor_id:'foreign'},{actor_role:'auditor'},{actor_type:'worker'},{kind:'reply'}]){
      const changed=structuredClone(ledger);Object.assign(changed.tables.case_voice[0],change);assert.throws(()=>validatePrivacyLedger(changed,f.baseline),/authorship/);
    }
    const old=structuredClone(ledger);old.format='understood-postgres-privacy-ledger-v7';assert.throws(()=>validatePrivacyLedger(old,f.baseline),/Invalid privacy ledger/);
  }finally{await f.close();}
});

async function expiredBriefingLedger(f) {
  await saveBriefingRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
  await f.db.query("INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at) VALUES($1,'org','site','retired-brief','{}','[\"retired-pub\"]','owner',clock_timestamp()-interval '10 days')",[randomUUID()]);
  await f.db.exec("UPDATE publications SET state='archived' WHERE id='retired-pub'");
  assert.equal(await processOneBriefingContentPurge(f.pool,{schema}),true);
  await saveBriefingRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
  return exportPrivacyLedger(f.pool,f.baseline,f.options);
}

test('briefing restore replay freshly erases bound content atomically without rewriting version history or current policy',async()=>{
  const f=await fixture({retiredPublication:true});try{
    const ledger=await expiredBriefingLedger(f),options={isolatedTarget:true,writersStopped:true};await f.quarantine();
    await assert.rejects(replayPrivacyBriefings(f.targetPool,f.baseline,ledger,options),/original briefing policy/);
    await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options);
    const before=await inventory({pool:f.targetPool});
    const original=ledger.tables.briefing_content_origins[0];
    assert.equal((await f.target.query('SELECT briefing_origin_valid($1::jsonb) AS valid',[JSON.stringify(original)])).rows[0].valid,true);
    for(const mutate of [row=>{row.context_json.assignments[0].publication_id='foreign';},row=>{row.context_json.assignments[0].created_at=null;}]) {
      const invalid=structuredClone(original);mutate(invalid);
      assert.equal((await f.target.query('SELECT briefing_origin_valid($1::jsonb) AS valid',[JSON.stringify(invalid)])).rows[0].valid,false);
    }
    const journalArgs=['retired-brief','org','site',f.baseline.id,ledger.id,privacyLedgerFingerprint(ledger),JSON.stringify(original),ledger.capturedAt];
    await assert.rejects(f.target.query('INSERT INTO restore_briefing_redactions(briefing_id,org_id,site_id,backup_id,ledger_id,ledger_fingerprint,source_origin_json,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',journalArgs),/physical redaction incomplete/);
    await assert.rejects(f.target.query("INSERT INTO restore_briefing_redactions(briefing_id,org_id,site_id,backup_id,ledger_id,ledger_fingerprint,source_origin_json,source_captured_at,imported_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2000-01-01')",journalArgs),/restore proof/);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    f.targetPool.fail('INSERT INTO audit');await assert.rejects(replayPrivacyBriefings(f.targetPool,f.baseline,ledger,options),/Injected/);f.targetPool.fail('');
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    const result=await replayPrivacyBriefings(f.targetPool,f.baseline,ledger,options);
    assert.equal(result.briefingRedactions,1);assert.equal(result.journaled,1);assert.equal(result.activationAllowed,false);assert.equal(result.productionReady,false);
    assert.deepEqual((await f.target.query("SELECT title,source FROM briefings WHERE id='retired-brief'")).rows[0],{title:'[Expired]',source:'[Expired]'});
    assert.equal((await f.target.query("SELECT state FROM publications WHERE id='retired-pub'")).rows[0].state,'published');
    assert.equal((await f.target.query('SELECT count(*)::int AS n FROM briefing_archives')).rows[0].n,0);
    assert.equal((await f.target.query('SELECT days FROM briefing_retention_policies')).rows[0].days,null);
    const journal=(await f.target.query('SELECT * FROM restore_briefing_redactions')).rows[0],purge=(await f.target.query('SELECT * FROM briefing_content_purges')).rows[0];
    assert.deepEqual(journal.source_origin_json,ledger.tables.briefing_content_origins[0]);
    assert.equal(new Date(journal.source_captured_at).toISOString(),ledger.capturedAt);
    assert.ok(new Date(purge.completed_at).getTime()>=new Date(journal.imported_at).getTime());
    assert.equal((await f.target.query('SELECT count(*)::int AS n FROM briefing_content_origins')).rows[0].n,0);
    assert.equal((await f.target.query("SELECT publication_content_available('retired-pub') AS publication,assignment_content_available('retired-assignment') AS assignment")).rows[0].assignment,false);
    const after=await inventory({pool:f.targetPool});assert.equal((await replayPrivacyBriefings(f.targetPool,f.baseline,ledger,options)).duplicate,true);
    assert.deepEqual(await inventory({pool:f.targetPool}),after);
    assert.equal((await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options)).historicalContentReplayPending.briefing,0);
    await assert.rejects(f.target.exec("INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text) VALUES('fresh','org','site','retired-assignment','new','Never accepted')"),/Expired briefing/);
    for(const sql of ['DELETE FROM restore_briefing_redactions',"UPDATE restore_briefing_redactions SET source_origin_json='{}'","UPDATE briefings SET source='Resurrected' WHERE id='retired-brief'"])
      await assert.rejects(f.target.exec(sql),/immutable|read-only/);
  }finally{await f.close();}
});

test('second briefing replay preserves root source origin rather than replacing it with intermediate cleanup clocks',async()=>{
  const f=await fixture({retiredPublication:true});let second;try{
    const ledger=await expiredBriefingLedger(f),options={isolatedTarget:true,writersStopped:true};await f.quarantine();await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options);
    const baseline={...f.baseline,id:randomUUID(),createdAt:new Date().toISOString(),...await inventory({pool:f.targetPool})};
    second=new PGlite({loadDataDir:await f.target.dumpDataDir('none')});const pool=poolFor(second);await second.exec(`SET search_path TO ${schema},pg_catalog`);
    await replayPrivacyBriefings(f.targetPool,f.baseline,ledger,options);
    const later=await exportPrivacyLedger(f.targetPool,baseline,f.options);
    assert.deepEqual(later.tables.briefing_content_origins[0],ledger.tables.briefing_content_origins[0]);
    await quarantineRestoredDatabase(pool,{schema,backupId:baseline.id});assert.equal((await replayPrivacyBriefings(pool,baseline,later,options)).briefingRedactions,1);
    const root=(await second.query('SELECT source_origin_json,source_captured_at FROM restore_briefing_redactions')).rows[0];
    assert.deepEqual(root.source_origin_json,ledger.tables.briefing_content_origins[0]);assert.equal(new Date(root.source_captured_at).toISOString(),ledger.capturedAt);
    assert.equal((await second.query("SELECT state FROM publications WHERE id='retired-pub'")).rows[0].state,'published');
  }finally{if(second)await second.close();await f.close();}
});

test('encrypted briefing replay requires confirmed distinct target and persists exact authenticated replay evidence',async()=>{
  const f=await fixture({retiredPublication:true}),key=backupKey('e9'.repeat(32));try{
    const backupDirectory=await createPrivateDirectory(join(f.root,'baseline'));await writeBackupCompletion(backupDirectory,f.baseline,key);
    await expiredBriefingLedger(f);const ledgerDirectory=join(f.root,'ledger');
    await createPrivacyLedgerExport({pool:f.pool,connection,backupDirectory,directory:ledgerDirectory,key,writersStopped:true});
    const ledger=await readBackupCompletion(ledgerDirectory,key);await f.quarantine();await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,{isolatedTarget:true,writersStopped:true});
    const options={...await fixtureState(f,key),pool:f.targetPool,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},backupDirectory,ledgerDirectory,directory:join(f.root,'result'),key,isolatedTarget:true,writersStopped:true,confirmed:true};
    await assert.rejects(replayPrivacyRestoreBriefings({...options,confirmed:false}),/confirmed/);await assert.rejects(replayPrivacyRestoreBriefings({...options,connection}),/source database/);
    const result=await replayPrivacyRestoreBriefings(options);assert.equal(result.briefingRedactions,1);
    assert.deepEqual(JSON.parse((await decryptBackupBytes(join(options.directory,'privacy-briefings.enc'),key,`understood:restore:${f.baseline.id}:privacy-briefings:${ledger.id}`)).toString()),result);
    await assert.rejects(replayPrivacyRestoreBriefings(options),/EEXIST/);
    const before=await inventory({pool:f.targetPool});assert.equal((await replayPrivacyRestoreBriefings({...options,...retryState(options.directory),directory:join(f.root,'recovered')})).duplicate,true);assert.deepEqual(await inventory({pool:f.targetPool}),before);
  }finally{key.fill(0);await f.close();}
});

test('privacy export preserves original later actor/request evidence, includes current policies and omits worker content and labels',async()=>{
  const f=await fixture();try{
    const requestId=await f.laterPrivacy(),before=await inventory(f);
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);
    assert.equal(ledger.backupId,f.baseline.id);assert.equal(ledger.tables.worker_deletion_requests.find(row=>row.id===requestId).actor_id,'later-owner');
    assert.equal(ledger.tables.worker_deletion_requests.length,2);assert.equal(ledger.tables.retention_policies[0].audio_days,7);
    assert.equal(ledger.tables.text_retention_policies[0].days,7);assert.equal(ledger.objects[0].retained,false);
    assert.ok(!JSON.stringify(ledger).includes('SECRET_'));assert.equal(ledger.tables.publications[0].snapshot_sha256.length,64);
    assert.equal(ledger.sourceInventory.tables.some(row=>row.name==='future"evidence'),true);
    assert.deepEqual(await inventory(f),before);assert.equal(f.pool.snapshots,1);
    assert.equal(privacyLedgerFingerprint(ledger).length,64);
  }finally{await f.close();}
});

test('read-only restore comparison finds later deletion, missing original actor, policies, redaction and retirement without changing evidence',async()=>{
  const f=await fixture();try{
    await f.laterPrivacy();await processOneAudioPurge(f.pool,{async remove(){},async exists(){return false;}},{schema});
    await processOneDeletionRedaction(f.pool,{schema});await processOneDeletionPseudonym(f.pool,{schema});
    await processOneDeletionCompletion(f.pool,{async exists(){return false;}},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);
    await f.quarantine();const before=await inventory({pool:f.targetPool});
    const report=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,{isolatedTarget:true,writersStopped:true});
    assert.deepEqual(report.conflicts,[]);assert.equal(report.missingReceipts.worker_deletion_requests,1);
    assert.equal(report.missingActors.worker_deletion_requests,1);assert.equal(report.relevantDeletionRequests,1);
    assert.equal(report.changedPolicies.retention_policies,1);assert.equal(report.changedPolicies.text_retention_policies,1);
    assert.equal(report.restrictions.workers,1);assert.equal(report.redactions.attempts,1);assert.equal(report.redactions.recordings,1);assert.equal(report.privateRetirements,1);
    assert.equal(report.authoritativeReconciliationComplete,false);assert.equal(report.activationAllowed,false);assert.equal(report.productionReady,false);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    assert.equal((await f.target.query("SELECT actor_id FROM worker_deletion_requests")).rows.length,0);
    assert.equal((await f.target.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'SECRET_ANSWER');
  }finally{await f.close();}
});

test('privacy ledger validation rejects another baseline/source, old timestamp, missing families, duplicate identity and forbidden content',async()=>{
  const f=await fixture();try{
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options),alter=change=>({...structuredClone(ledger),...change});
    assert.throws(()=>validatePrivacyLedger(alter({format:'understood-postgres-privacy-ledger-v3'}),f.baseline),/binding/);
    assert.throws(()=>validatePrivacyLedger(alter({backupId:randomUUID()}),f.baseline),/binding/);
    assert.throws(()=>validatePrivacyLedger(alter({sourceIdentitySha256:'d'.repeat(64)}),f.baseline),/binding/);
    assert.throws(()=>validatePrivacyLedger(alter({capturedAt:'2000-01-01T00:00:00Z'}),f.baseline),/binding/);
    assert.throws(()=>validatePrivacyLedger(ledger,{...f.baseline,createdAt:'2000-01-01T00:00:00Z'}),/binding/);
    const missing=alter({});delete missing.tables.case_content_purges;assert.throws(()=>validatePrivacyLedger(missing,f.baseline),/binding/);
    const duplicate=alter({});duplicate.tables.workers.push({...duplicate.tables.workers[0]});assert.throws(()=>validatePrivacyLedger(duplicate,f.baseline),/duplicated/);
    const forbidden=alter({});forbidden.tables.attempts[0].answer_text='SECRET_ANSWER';assert.throws(()=>validatePrivacyLedger(forbidden,f.baseline),/content/);
    const object=alter({});object.objects.push({...object.objects[0]});assert.throws(()=>validatePrivacyLedger(object,f.baseline),/object/);
    const before=await inventory(f);
    await assert.rejects(exportPrivacyLedger(f.pool,f.baseline,{...f.options,writersStopped:false}),/stopped/);
    await assert.rejects(exportPrivacyLedger(f.pool,f.baseline,{...f.options,sourceIdentitySha256:'e'.repeat(64)}),/original backup source/);
    await f.db.exec("UPDATE system_controls SET jobs_paused=false WHERE id='global'");
    await assert.rejects(exportPrivacyLedger(f.pool,f.baseline,f.options),/Pause jobs/);
    await f.db.exec("UPDATE system_controls SET jobs_paused=true WHERE id='global'");assert.deepEqual(await inventory(f),before);
  }finally{await f.close();}
});

test('ledger exposes historical activity and briefing expiry without silently certifying or copying source completion',async()=>{
  const f=await fixture();try{
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    assert.equal(await processOneActivityPurge(f.pool,{schema}),true);
    await saveBriefingRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await f.db.query("INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at) VALUES($1,'org','site','retired-brief','{}','[]','owner',clock_timestamp()-interval '10 days')",[randomUUID()]);
    assert.equal(await processOneBriefingContentPurge(f.pool,{schema}),true);
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    await saveBriefingRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);
    assert.equal(ledger.format,'understood-postgres-privacy-ledger-v8');assert.doesNotMatch(JSON.stringify(ledger),/SECRET_/);
    await f.quarantine();const options={isolatedTarget:true,writersStopped:true},before=await inventory({pool:f.targetPool});
    const report=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);
    assert.deepEqual(report.conflicts,[]);assert.deepEqual(report.historicalContentReplayPending,{activity:1,briefing:1});
    assert.equal(report.missingReceipts.activity_identity_purges,1);assert.equal(report.missingReceipts.briefing_content_purges,1);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    const replay=await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options);
    assert.equal(replay.changedPolicyRows,2);assert.equal(replay.importedRequests,4);assert.deepEqual(replay.historicalContentReplayPending,{activity:1,briefing:1});
    assert.equal(replay.activationAllowed,false);assert.equal(replay.authoritativeReconciliationComplete,false);
    assert.equal((await f.target.query("SELECT source FROM briefings WHERE id='retired-brief'")).rows[0].source,'SECRET_RETIRED_SOURCE');
    assert.equal((await f.target.query('SELECT count(*)::int AS n FROM briefing_content_purges')).rows[0].n,0);
    assert.equal((await f.target.query("SELECT object_id FROM audit WHERE id='old-activity'")).rows[0].object_id,'SECRET_ACTIVITY_ITEM');
    const changed=structuredClone(ledger);changed.tables.briefing_content_purges[0].proofs_json.briefings['retired-brief']='PRIVATE text';
    assert.throws(()=>validatePrivacyLedger(changed,f.baseline),/content proofs/);
    const foreign=structuredClone(ledger);foreign.tables.activity_identity_purges[0].site_id='foreign';
    assert.throws(()=>validatePrivacyLedger(foreign,f.baseline),/retirement evidence/);
    const missing=structuredClone(ledger);missing.tables.activity_retention_requests=[];
    assert.throws(()=>validatePrivacyLedger(missing,f.baseline),/retirement evidence/);
    const noOrigin=structuredClone(ledger);noOrigin.tables.briefing_content_origins=[];
    assert.throws(()=>validatePrivacyLedger(noOrigin,f.baseline),/expiry provenance/);
    const oldFormat=structuredClone(ledger);oldFormat.format='understood-postgres-privacy-ledger-v4';
    assert.throws(()=>validatePrivacyLedger(oldFormat,f.baseline),/binding/);
    for(const mutate of [
      row=>{row.context_json.briefing.source='SECRET_COPY';},
      row=>{row.context_json.archive.occurred_at=row.captured_at;},
      row=>{row.source_receipt_json.completed_at='2000-01-01T00:00:00Z';},
      row=>{row.source_policy_json.request_json.days=30;},
      row=>{row.context_json.archive.org_id='foreign';},
      row=>{row.context_json.archive.request_sha256='not-a-hash';},
    ]) {
      const invalid=structuredClone(ledger);mutate(invalid.tables.briefing_content_origins[0]);
      assert.throws(()=>validatePrivacyLedger(invalid,f.baseline),/expiry provenance/);
    }
  }finally{await f.close();}
});

test('archived source snapshots bind only the original target projections, not changed content or extra owned copies',async()=>{
  const f=await fixture({retiredPublication:true});try{
    await saveBriefingRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await f.db.query("INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at) VALUES($1,'org','site','retired-brief','{\"reason\":\"SECRET_ARCHIVE_REASON\"}','[\"retired-pub\"]','owner',clock_timestamp()-interval '10 days')",[randomUUID()]);
    await f.db.exec("UPDATE publications SET state='archived' WHERE id='retired-pub'");
    assert.equal(await processOneBriefingContentPurge(f.pool,{schema}),true);
    await saveBriefingRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);assert.doesNotMatch(JSON.stringify(ledger),/SECRET_/);
    const original=ledger.tables.briefing_content_origins[0];
    assert.equal(original.context_json.publications[0].state,'archived');assert.deepEqual(original.context_json.archive.publication_ids,['retired-pub']);
    await f.quarantine();const options={isolatedTarget:true,writersStopped:true},before=await inventory({pool:f.targetPool});
    const plan=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);
    assert.deepEqual(plan.conflicts,[]);assert.equal(plan.redactions.briefings,1);assert.equal(plan.activationAllowed,false);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    assert.equal((await f.target.query("SELECT state FROM publications WHERE id='retired-pub'")).rows[0].state,'published');
    assert.equal((await f.target.query('SELECT count(*)::int AS n FROM briefing_archives')).rows[0].n,0);
    await f.target.exec("UPDATE draft_reviews SET content_json='{\"facts\":[\"Changed target content\"]}' WHERE briefing_id='retired-brief'");
    const changed=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);
    assert.ok(changed.conflicts.some(row=>row.table==='briefings' && row.reason==='original_content_unbound'));
    await assert.rejects(replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options),/conflicts/);
    await f.target.exec("UPDATE draft_reviews SET content_json='{\"facts\":[\"SECRET_REVIEW\"]}' WHERE briefing_id='retired-brief'");
    await f.target.query("INSERT INTO briefing_review_requests(request_id,org_id,site_id,briefing_id,accepted_revision,request_json,requested_by) VALUES($1,'org','site','retired-brief',2,'{}','owner')",[randomUUID()]);
    const extra=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);
    assert.ok(extra.conflicts.some(row=>row.table==='briefings' && row.reason==='original_content_unbound'));
    const forged=structuredClone(ledger);forged.tables.briefing_content_purges[0].proofs_json.publications['retired-pub']='d'.repeat(64);
    assert.throws(()=>validatePrivacyLedger(forged,f.baseline),/expiry provenance/);
  }finally{await f.close();}
});

test('historical activity replay preserves original policy provenance, rolls back atomically and does not restore disabled-policy identifiers',async()=>{
  const f=await fixture();try{
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    assert.equal(await processOneActivityPurge(f.pool,{schema}),true);
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);await f.quarantine();const options={isolatedTarget:true,writersStopped:true};
    await assert.rejects(replayPrivacyActivity(f.targetPool,f.baseline,ledger,options),/original activity policy/);
    await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options);
    const before=await inventory({pool:f.targetPool}),original=(await f.target.query("SELECT to_jsonb(e)-'actor_id'-'object_id' AS row FROM audit e WHERE id='old-activity'")).rows[0].row;
    f.targetPool.fail('INSERT INTO audit');await assert.rejects(replayPrivacyActivity(f.targetPool,f.baseline,ledger,options),/Injected/);f.targetPool.fail('');
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    const result=await replayPrivacyActivity(f.targetPool,f.baseline,ledger,options);assert.equal(result.activityRedactions,1);assert.equal(result.journaled,1);
    assert.equal(result.activationAllowed,false);assert.equal(result.authoritativeReconciliationComplete,false);
    assert.deepEqual((await f.target.query("SELECT actor_id,object_id FROM audit WHERE id='old-activity'")).rows[0],{actor_id:'',object_id:''});
    assert.deepEqual((await f.target.query("SELECT to_jsonb(e)-'actor_id'-'object_id' AS row FROM audit e WHERE id='old-activity'")).rows[0].row,original);
    assert.equal((await f.target.query('SELECT days FROM activity_retention_policies')).rows[0].days,null);
    const proof=(await f.target.query('SELECT source_receipt_json,original_event_json FROM restore_activity_redactions')).rows[0];
    assert.deepEqual(proof.source_receipt_json,ledger.tables.activity_identity_purges[0]);assert.equal('actor_id' in proof.original_event_json,false);
    assert.equal((await f.target.query("SELECT count(*)::int AS n FROM operational_audit_receipts WHERE action='backup.restore.privacy.activity'")).rows[0].n,1);
    const after=await inventory({pool:f.targetPool});assert.equal((await replayPrivacyActivity(f.targetPool,f.baseline,ledger,options)).duplicate,true);assert.deepEqual(await inventory({pool:f.targetPool}),after);
    const plan=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);assert.equal(plan.historicalContentReplayPending.activity,0);
    for(const sql of ['DELETE FROM restore_activity_redactions',"UPDATE restore_activity_redactions SET original_event_json='{}'","UPDATE audit SET object_id='resurrected' WHERE id='old-activity'"])await assert.rejects(f.target.exec(sql),/immutable|read-only/);
    await f.target.exec("UPDATE system_controls SET jobs_paused=false WHERE id='global'");await assert.rejects(replayPrivacyActivity(f.targetPool,f.baseline,ledger,options),/quarantine/);
  }finally{await f.close();}
});

test('a second backup retains root activity-expiry proof rather than treating a later target cleanup time as the original decision',async()=>{
  const f=await fixture();let second;try{
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});await processOneActivityPurge(f.pool,{schema});
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options),options={isolatedTarget:true,writersStopped:true};await f.quarantine();await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options);
    const baseline={...f.baseline,id:randomUUID(),createdAt:new Date().toISOString(),...await inventory({pool:f.targetPool})};
    second=new PGlite({loadDataDir:await f.target.dumpDataDir('none')});const pool=poolFor(second);await second.exec(`SET search_path TO ${schema},pg_catalog`);
    await replayPrivacyActivity(f.targetPool,f.baseline,ledger,options);
    const later=await exportPrivacyLedger(f.targetPool,baseline,f.options);assert.equal(later.tables.restore_activity_redactions.length,1);
    await quarantineRestoredDatabase(pool,{schema,backupId:baseline.id});const result=await replayPrivacyActivity(pool,baseline,later,options);
    assert.equal(result.activityRedactions,1);
    const proof=(await second.query('SELECT source_receipt_json,source_captured_at FROM restore_activity_redactions')).rows[0];
    assert.deepEqual(proof.source_receipt_json,ledger.tables.activity_identity_purges[0]);assert.equal(new Date(proof.source_captured_at).toISOString(),ledger.capturedAt);
    assert.equal((await second.query('SELECT days FROM activity_retention_policies')).rows[0].days,null);assert.equal(result.activationAllowed,false);
  }finally{if(second)await second.close();await f.close();}
});

test('encrypted activity replay requires confirmed distinct stopped target and recovers through an exact immutable receipt',async()=>{
  const f=await fixture(),key=backupKey('e8'.repeat(32));try{
    const backupDirectory=await createPrivateDirectory(join(f.root,'baseline'));await writeBackupCompletion(backupDirectory,f.baseline,key);
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});await processOneActivityPurge(f.pool,{schema});
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    const ledgerDirectory=join(f.root,'ledger');await createPrivacyLedgerExport({pool:f.pool,connection,backupDirectory,directory:ledgerDirectory,key,writersStopped:true});
    const ledger=await readBackupCompletion(ledgerDirectory,key);await f.quarantine();await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,{isolatedTarget:true,writersStopped:true});
    const options={...await fixtureState(f,key),pool:f.targetPool,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},backupDirectory,ledgerDirectory,directory:join(f.root,'result'),key,isolatedTarget:true,writersStopped:true,confirmed:true};
    await assert.rejects(replayPrivacyRestoreActivity({...options,confirmed:false}),/confirmed/);await assert.rejects(replayPrivacyRestoreActivity({...options,connection}),/source database/);
    const result=await replayPrivacyRestoreActivity(options);assert.equal(result.activityRedactions,1);
    assert.deepEqual(JSON.parse((await decryptBackupBytes(join(options.directory,'privacy-activity.enc'),key,`understood:restore:${f.baseline.id}:privacy-activity:${ledger.id}`)).toString()),result);
    await assert.rejects(replayPrivacyRestoreActivity(options),/EEXIST/);
    const recovered=await replayPrivacyRestoreActivity({...options,...retryState(options.directory),directory:join(f.root,'recovered')});assert.equal(recovered.duplicate,true);assert.equal(recovered.activityRedactions,0);assert.equal(recovered.activationAllowed,false);
  }finally{key.fill(0);await f.close();}
});

test('restore inspection refuses active/other restore, changed guarded definitions and fabricated immutable bindings',async()=>{
  const f=await fixture();try{
    const requestId=await f.laterPrivacy(),ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options),options={isolatedTarget:true,writersStopped:true};
    await assert.rejects(planPrivacyReconciliation(f.targetPool,f.baseline,ledger,{...options,isolatedTarget:false}),/stopped isolated/);
    await assert.rejects(planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options),/quarantine/);
    await requestWorkerDeletion(f.targetPool,session,'worker',{requestId,expectedCode:'SECRET_WORKER_LABEL',reason:'customer_policy',confirmed:true},{schema});
    await f.quarantine();
    const conflicting=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);
    assert.ok(conflicting.conflicts.some(row=>row.reason==='immutable_receipt_conflict'));
    const changed=structuredClone(ledger);changed.tables.publications[0].snapshot_sha256='d'.repeat(64);
    assert.ok((await planPrivacyReconciliation(f.targetPool,f.baseline,changed,options)).conflicts.some(row=>row.table==='publications'));
    await f.target.exec('CREATE FUNCTION unexpected_guard() RETURNS integer LANGUAGE sql AS $$SELECT 1$$');
    await assert.rejects(planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options),/guarded definitions/);
  }finally{await f.close();}
});

test('encrypted privacy commands use original source and distinct quarantined target, bind output purpose, refuse overwrite and preserve failed evidence',async()=>{
  const f=await fixture(),key=backupKey('c8'.repeat(32));try{
    const backupDirectory=await createPrivateDirectory(join(f.root,'baseline'));
    // Authored encrypted baseline covers command binding, not native archive transport.
    await writeBackupCompletion(backupDirectory,f.baseline,key);await f.laterPrivacy();
    const directory=join(f.root,'ledger'),args={pool:f.pool,connection,backupDirectory,directory,key,writersStopped:true};
    await assert.rejects(createPrivacyLedgerExport({...args,writersStopped:false}),/Stop all/);
    await assert.rejects(createPrivacyLedgerExport({...args,connection:{connectionString:'postgresql://operator:private@127.0.0.1/other'}}),/original backup source/);
    const exported=await createPrivacyLedgerExport(args),ledger=await readBackupCompletion(directory,key);
    assert.equal(exported.ledgerFingerprint,privacyLedgerFingerprint(ledger));assert.ok(!(await readFile(join(directory,'manifest.enc'))).includes(Buffer.from('SECRET_')));
    await assert.rejects(createPrivacyLedgerExport(args),/EEXIST/);
    await f.quarantine();const before=await inventory({pool:f.targetPool});
    const inspect={pool:f.targetPool,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},backupDirectory,ledgerDirectory:directory,
      directory:join(f.root,'report'),key,writersStopped:true,isolatedTarget:true};
    await assert.rejects(inspectPrivacyRestore({...inspect,connection}),/source database/);
    const report=await inspectPrivacyRestore(inspect),file=join(inspect.directory,'privacy-plan.enc');
    assert.deepEqual(JSON.parse((await decryptBackupBytes(file,key,`understood:restore:${f.baseline.id}:privacy-plan:${ledger.id}`)).toString('utf8')),report);
    await assert.rejects(decryptBackupBytes(file,key,`understood:restore:${randomUUID()}:privacy-plan:${ledger.id}`),/authentication/);
    await assert.rejects(inspectPrivacyRestore(inspect),/EEXIST/);assert.deepEqual(await inventory({pool:f.targetPool}),before);
    f.pool.fail('FROM workers ORDER BY');
    await assert.rejects(createPrivacyLedgerExport({...args,directory:join(f.root,'failed')}),/Injected/);
    await assert.rejects(readFile(join(f.root,'failed','manifest.enc')),/ENOENT/);
  }finally{key.fill(0);await f.close();}
});

test('original deletion replay retains authorship and timestamp, disables missing actor, creates no completion and exact retry performs no writes',async()=>{
  const f=await fixture();try{
    const requestId=await f.laterPrivacy();
    await processOneAudioPurge(f.pool,{async remove(){},async exists(){return false;}},{schema});
    await processOneDeletionRedaction(f.pool,{schema});await processOneDeletionPseudonym(f.pool,{schema});
    await processOneDeletionCompletion(f.pool,{async exists(){return false;}},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options),sourceBefore=await inventory(f);
    await f.quarantine();const options={isolatedTarget:true,writersStopped:true};
    const result=await replayPrivacyDeletions(f.targetPool,f.baseline,ledger,options);
    assert.equal(result.importedRequests,1);assert.equal(result.importedActors,1);assert.equal(result.duplicate,false);
    await f.target.exec("SET timezone='UTC'");
    const actual=(await f.target.query('SELECT to_jsonb(d) AS row FROM worker_deletion_requests d')).rows;
    assert.deepEqual(actual,[{row:ledger.tables.worker_deletion_requests.find(row=>row.id===requestId)}]);
    assert.equal((await f.target.query("SELECT active FROM workers WHERE id='worker'")).rows[0].active,false);
    const actor=(await f.target.query("SELECT name,role,active FROM staff WHERE id='later-owner'")).rows[0];
    assert.deepEqual(actor,{name:'[Restored privacy actor]',role:'owner',active:false});
    assert.equal((await f.target.query("SELECT count(*)::integer AS n FROM staff_credentials WHERE staff_id='later-owner'")).rows[0].n,0);
    assert.equal((await f.target.query('SELECT count(*)::integer AS n FROM worker_deletion_completions')).rows[0].n,0);
    assert.equal((await f.target.query('SELECT count(*)::integer AS n FROM recording_purges')).rows[0].n,0);
    assert.equal((await f.target.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'SECRET_ANSWER');
    assert.equal((await f.target.query('SELECT transcript,status FROM recordings')).rows[0].transcript,null);
    assert.equal(result.activationAllowed,false);assert.equal(result.authoritativeReconciliationComplete,false);
    const after=await inventory({pool:f.targetPool});
    const retry=await replayPrivacyDeletions(f.targetPool,f.baseline,ledger,options);
    assert.equal(retry.duplicate,true);assert.equal(retry.importedRequests,0);assert.deepEqual(await inventory({pool:f.targetPool}),after);
    const altered=structuredClone(ledger);altered.capturedAt=new Date(Date.parse(ledger.capturedAt)+1000).toISOString();
    await assert.rejects(replayPrivacyDeletions(f.targetPool,f.baseline,altered,options),/ledger receipt conflict/);
    assert.deepEqual(await inventory({pool:f.targetPool}),after);assert.deepEqual(await inventory(f),sourceBefore);
    // Local completion must be established anew by existing physical-absence guarded cleanup.
    await processOneAudioPurge(f.targetPool,{async remove(){},async exists(){return false;}},{schema});
    await processOneDeletionRedaction(f.targetPool,{schema});await processOneDeletionPseudonym(f.targetPool,{schema});
    await processOneDeletionCompletion(f.targetPool,{async exists(){return false;}},{schema});
    assert.equal((await f.target.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'[Deleted]');
    assert.equal((await f.target.query('SELECT count(*)::integer AS n FROM worker_deletion_completions')).rows[0].n,1);
    assert.equal((await replayPrivacyDeletions(f.targetPool,f.baseline,ledger,options)).duplicate,true);
  }finally{await f.close();}
});

test('replay rejects ambiguous redaction, missing decision actor, changed input and active target; audit failure rolls back the whole import',async()=>{
  const f=await fixture();try{
    const empty=await exportPrivacyLedger(f.pool,f.baseline,f.options),ambiguous=structuredClone(empty);
    ambiguous.tables.attempts[0].redacted=true;
    await f.quarantine();const options={isolatedTarget:true,writersStopped:true},before=await inventory({pool:f.targetPool});
    assert.ok((await planPrivacyReconciliation(f.targetPool,f.baseline,ambiguous,options)).conflicts.some(row=>row.reason==='redaction_authority_unavailable'));
    await assert.rejects(replayPrivacyDeletions(f.targetPool,f.baseline,ambiguous,options),/conflicts/);
    await f.laterPrivacy();const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);
    const missingActor=structuredClone(ledger);missingActor.tables.staff=missingActor.tables.staff.filter(row=>row.id!=='later-owner');
    assert.throws(()=>validatePrivacyLedger(missingActor,f.baseline),/decision evidence/);
    const badFingerprint=structuredClone(ledger);badFingerprint.tables.worker_deletion_requests[0].fingerprint='invalid';
    assert.throws(()=>validatePrivacyLedger(badFingerprint,f.baseline),/decision evidence/);
    await assert.rejects(replayPrivacyDeletions(f.targetPool,f.baseline,ledger,{...options,writersStopped:false}),/stopped isolated/);
    f.targetPool.fail('INSERT INTO audit');await assert.rejects(replayPrivacyDeletions(f.targetPool,f.baseline,ledger,options),/Injected/);f.targetPool.fail('');
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    const changed=structuredClone(ledger);changed.tables.recordings[0].sha256='e'.repeat(64);
    await assert.rejects(replayPrivacyDeletions(f.targetPool,f.baseline,changed,options),/conflicts/);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    await f.target.exec("UPDATE system_controls SET provider_paused=false WHERE id='global'");
    await assert.rejects(replayPrivacyDeletions(f.targetPool,f.baseline,ledger,options),/quarantine/);
  }finally{await f.close();}
});

test('encrypted deletion replay requires explicit confirmation, distinct target and recoverable database receipt after lost acknowledgement',async()=>{
  const f=await fixture(),key=backupKey('d9'.repeat(32));try{
    const backupDirectory=await createPrivateDirectory(join(f.root,'baseline'));await writeBackupCompletion(backupDirectory,f.baseline,key);
    await f.laterPrivacy();const ledgerDirectory=join(f.root,'ledger');
    await createPrivacyLedgerExport({pool:f.pool,connection,backupDirectory,directory:ledgerDirectory,key,writersStopped:true});
    const ledger=await readBackupCompletion(ledgerDirectory,key);await f.quarantine();
    const options={...await fixtureState(f,key),pool:f.targetPool,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},backupDirectory,ledgerDirectory,
      directory:join(f.root,'result'),key,isolatedTarget:true,writersStopped:true,confirmed:true};
    await assert.rejects(replayPrivacyRestoreDeletions({...options,confirmed:false}),/confirmed/);
    await assert.rejects(replayPrivacyRestoreDeletions({...options,connection}),/source database/);
    const result=await replayPrivacyRestoreDeletions(options);
    assert.equal(result.importedRequests,1);
    assert.deepEqual(JSON.parse((await decryptBackupBytes(join(options.directory,'privacy-deletions.enc'),key,
      `understood:restore:${f.baseline.id}:privacy-deletions:${ledger.id}`)).toString('utf8')),result);
    await assert.rejects(replayPrivacyRestoreDeletions(options),/EEXIST/);
    const retry=await replayPrivacyRestoreDeletions({...options,...retryState(options.directory),directory:join(f.root,'recovered')});
    assert.equal(retry.duplicate,true);assert.equal(retry.importedRequests,0);assert.equal(retry.activationAllowed,false);
  }finally{key.fill(0);await f.close();}
});

test('policy replay preserves all six decisions and receipts including later actor and explicit disable; failures roll back and retries do not dispatch or write',async()=>{
  const f=await fixture();try{
    await f.laterPrivacy();
    await saveCaseRetention(f.pool,{...session,principal_id:'later-owner'},{requestId:randomUUID(),revision:0,days:30,confirmed:true},{schema});
    await saveGeneratedRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await saveGeneratedRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await saveActivityRetention(f.pool,session,{requestId:randomUUID(),revision:1,days:null,confirmed:true},{schema});
    await saveBriefingRetention(f.pool,{...session,principal_id:'later-owner'},{requestId:randomUUID(),revision:0,days:90,confirmed:true},{schema});
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options),sourceBefore=await inventory(f);
    await f.quarantine();const options={isolatedTarget:true,writersStopped:true},before=await inventory({pool:f.targetPool});
    const changed=structuredClone(ledger);changed.tables.case_retention_policies[0].days=365;
    await assert.rejects(replayPrivacyPolicies(f.targetPool,f.baseline,changed,options),/policy receipt/);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    f.targetPool.fail('INSERT INTO audit');await assert.rejects(replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options),/Injected/);f.targetPool.fail('');
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    const result=await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options);
    assert.equal(result.changedPolicyRows,6);assert.equal(result.importedRequests,8);assert.equal(result.importedActors,1);assert.equal(result.duplicate,false);
    await f.target.exec("SET timezone='UTC'");
    for(const name of ['retention_policies','text_retention_policies','case_retention_policies','generated_retention_policies',
      'activity_retention_policies','briefing_retention_policies','retention_requests','text_retention_requests','case_retention_requests','generated_retention_requests',
      'activity_retention_requests','briefing_retention_requests']){
      const actual=(await f.target.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(row=>row.row);
      assert.deepEqual(actual,ledger.tables[name],name);
    }
    assert.equal((await f.target.query('SELECT days FROM generated_retention_policies')).rows[0].days,null);
    assert.equal((await f.target.query("SELECT active FROM staff WHERE id='later-owner'")).rows[0].active,false);
    assert.equal((await f.target.query('SELECT count(*)::integer AS n FROM worker_deletion_requests')).rows[0].n,0);
    assert.equal((await f.target.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'SECRET_ANSWER');
    assert.equal(result.activationAllowed,false);assert.equal(result.authoritativeReconciliationComplete,false);
    const after=await inventory({pool:f.targetPool});assert.equal((await replayPrivacyPolicies(f.targetPool,f.baseline,ledger,options)).duplicate,true);
    assert.deepEqual(await inventory({pool:f.targetPool}),after);assert.deepEqual(await inventory(f),sourceBefore);
    const latest=await planPrivacyReconciliation(f.targetPool,f.baseline,ledger,options);
    assert.deepEqual(latest.changedPolicies,{retention_policies:0,text_retention_policies:0,case_retention_policies:0,generated_retention_policies:0,activity_retention_policies:0,briefing_retention_policies:0});
    assert.equal(latest.missingReceipts.worker_deletion_requests,1);assert.equal(latest.activationAllowed,false);
  }finally{await f.close();}
});

test('encrypted policy command refuses unconfirmed/source replay and reports remaining privacy work despite a durable accepted receipt',async()=>{
  const f=await fixture(),key=backupKey('b7'.repeat(32));try{
    const backupDirectory=await createPrivateDirectory(join(f.root,'baseline'));await writeBackupCompletion(backupDirectory,f.baseline,key);await f.laterPrivacy();
    const ledgerDirectory=join(f.root,'ledger');await createPrivacyLedgerExport({pool:f.pool,connection,backupDirectory,directory:ledgerDirectory,key,writersStopped:true});
    const ledger=await readBackupCompletion(ledgerDirectory,key);await f.quarantine();
    const options={...await fixtureState(f,key),pool:f.targetPool,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},backupDirectory,ledgerDirectory,
      directory:join(f.root,'policies'),key,isolatedTarget:true,writersStopped:true,confirmed:true};
    await assert.rejects(replayPrivacyRestorePolicies({...options,confirmed:false}),/confirmed/);
    await assert.rejects(replayPrivacyRestorePolicies({...options,connection}),/source database/);
    const result=await replayPrivacyRestorePolicies(options);assert.equal(result.changedPolicyRows,2);
    assert.deepEqual(JSON.parse((await decryptBackupBytes(join(options.directory,'privacy-policies.enc'),key,
      `understood:restore:${f.baseline.id}:privacy-policies:${ledger.id}`)).toString('utf8')),result);
    assert.equal((await replayPrivacyRestorePolicies({...options,...retryState(options.directory),directory:join(f.root,'recovered')})).duplicate,true);
    assert.equal(result.authoritativeReconciliationComplete,false);assert.equal(result.activationAllowed,false);
  }finally{key.fill(0);await f.close();}
});

async function accountedFixture(f,key){
  const backupDirectory=await createPrivateDirectory(join(f.root,'accounted-backup'));
  await writeBackupCompletion(backupDirectory,f.baseline,key);
  const ledgerDirectory=join(f.root,'accounted-ledger');
  await createPrivacyLedgerExport({pool:f.pool,connection,backupDirectory,directory:ledgerDirectory,key,writersStopped:true});
  const ledger=await readBackupCompletion(ledgerDirectory,key);
  const {state}=await quarantineRestoredDatabase(f.targetPool,{schema,backupId:f.baseline.id,expected:f.baseline});
  state.targetIdentitySha256=hash('127.0.0.1:5432/restored');
  const stateFile=join(f.root,'accounted-quarantine.enc');
  await encryptBackupBytes(Buffer.from(JSON.stringify(state)),stateFile,key,`understood:restore:${f.baseline.id}:quarantine-state`);
  return {ledger,state,args:{pool:f.targetPool,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},
    backupDirectory,ledgerDirectory,directory:join(f.root,'accounted-deletions'),key,stateFile,stateKind:'quarantine',
    isolatedTarget:true,writersStopped:true,confirmed:true}};
}

test('production replay chains exact quarantine and successors, rejects stale/drifted/wrong-purpose/target states and recovers an acknowledgement',async()=>{
  const f=await fixture(),key=backupKey('e8'.repeat(32));try{
    await f.laterPrivacy();const sourceBefore=await inventory(f),{args,state}=await accountedFixture(f,key);
    await assert.rejects(replayPrivacyRestoreDeletions({...args,stateFile:undefined}),/predecessor/);
    await assert.rejects(replayPrivacyRestoreDeletions({...args,stateKind:'replay'}),/authentication/);
    await assert.rejects(replayPrivacyRestoreDeletions({...args,connection:{connectionString:'postgresql://operator:private@127.0.0.1/another'}}),/target binding/);
    const first=await replayPrivacyRestoreDeletions(args);
    assert.equal(first.state.predecessorStateSha256,restoreStateHash(state));
    assert.deepEqual({database:first.state.database,objects:first.state.objects},await inventory({pool:f.targetPool}));
    const policiesArgs={...args,...retryState(args.directory),directory:join(f.root,'accounted-policies')};
    const second=await replayPrivacyRestorePolicies(policiesArgs);
    assert.equal(second.state.predecessorStateSha256,restoreStateHash(first.state));
    const beforeRetry=await inventory({pool:f.targetPool});
    const recovered=await replayPrivacyRestorePolicies({...policiesArgs,...retryState(policiesArgs.directory),directory:join(f.root,'accounted-recovered')});
    assert.equal(recovered.duplicate,true);assert.deepEqual(recovered.state,second.state);
    assert.deepEqual(await inventory({pool:f.targetPool}),beforeRetry);
    await assert.rejects(replayPrivacyRestoreDeletions({...args,...retryState(args.directory),directory:join(f.root,'stale')}),/predecessor state/);
    await f.target.exec(`UPDATE "future""evidence" SET payload='{"drift":true}'`);
    const drifted=await inventory({pool:f.targetPool});
    await assert.rejects(replayPrivacyRestorePolicies({...policiesArgs,...retryState(policiesArgs.directory),directory:join(f.root,'drifted')}),/predecessor state/);
    assert.deepEqual(await inventory({pool:f.targetPool}),drifted);assert.deepEqual(await inventory(f),sourceBefore);
    assert.equal(second.activationAllowed,false);assert.equal(second.state.productionReady,false);
  }finally{key.fill(0);await f.close();}
});

test('precommit encrypted candidate survives a lost acknowledgement but a rolled-back commit candidate cannot certify the target',async()=>{
  const f=await fixture(),key=backupKey('e7'.repeat(32));try{
    await f.laterPrivacy();const {args}=await accountedFixture(f,key),before=await inventory({pool:f.targetPool});
    const failingPool={async connect(){const client=await f.targetPool.connect();let armed=false;
      return {async query(sql,values){if(sql==='SET CONSTRAINTS ALL IMMEDIATE')armed=true;
        if(armed && sql==='COMMIT')throw Error('Injected replay commit failure');return client.query(sql,values);},release(){client.release();}};}};
    await assert.rejects(replayPrivacyRestoreDeletions({...args,pool:failingPool}),/Injected replay commit/);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    const pending=JSON.parse((await decryptBackupBytes(join(args.directory,'replay-state.enc'),key,`understood:restore:${f.baseline.id}:replay-state`)).toString());
    assert.equal(pending.operation,'deletions');
    await assert.rejects(replayPrivacyRestoreDeletions({...args,...retryState(args.directory),directory:join(f.root,'rollback-retry')}),/predecessor state/);
    const committedArgs={...args,directory:join(f.root,'committed')};
    const first=await replayPrivacyRestoreDeletions(committedArgs);
    await rm(join(committedArgs.directory,'privacy-deletions.enc'));
    const retry=await replayPrivacyRestoreDeletions({...args,...retryState(committedArgs.directory),directory:join(f.root,'lost-ack')});
    assert.equal(retry.duplicate,true);assert.deepEqual(retry.state,first.state);
  }finally{f.targetPool.fail('');key.fill(0);await f.close();}
});

test('accounted replay forces deferred side effects and rolls back unexpected tables or failed candidate persistence',async()=>{
  const f=await fixture(),key=backupKey('e6'.repeat(32));try{
    const trigger=`CREATE FUNCTION replay_bad_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action LIKE 'backup.restore.privacy.%' THEN UPDATE "future""evidence" SET payload='{"unexpected":true}'; END IF; RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER replay_bad_deferred AFTER INSERT ON audit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION replay_bad_side_effect();`;
    await f.db.exec(trigger);await f.target.exec(trigger);
    Object.assign(f.baseline,await inventory({pool:f.targetPool}));
    await f.laterPrivacy();const {args,ledger,state}=await accountedFixture(f,key),before=await inventory({pool:f.targetPool});
    await assert.rejects(replayPrivacyRestoreDeletions(args),/unaccounted database/);
    assert.deepEqual(await inventory({pool:f.targetPool}),before);
    assert.equal(ledger.sourceInventory.definitionsSha256,state.database.definitionsSha256);
  }finally{key.fill(0);await f.close();}
  const g=await fixture(),key2=backupKey('e5'.repeat(32));try{
    await g.laterPrivacy();const {ledger,state}=await accountedFixture(g,key2),before=await inventory({pool:g.targetPool});
    await assert.rejects(replayPrivacyDeletions(g.targetPool,g.baseline,ledger,{isolatedTarget:true,writersStopped:true,predecessor:state,
      targetIdentitySha256:state.targetIdentitySha256,prepareState:async()=>{throw Error('Injected encryption failure');}}),/encryption failure/);
    assert.deepEqual(await inventory({pool:g.targetPool}),before);
  }finally{key2.fill(0);await g.close();}
});

test('privacy exports validate case voice authorship in every registered locale',async()=>{
  const f=await fixture({staffVoice:true,voiceLanguage:'hi'});try{
    const ledger=await exportPrivacyLedger(f.pool,f.baseline,f.options);
    assert.equal(ledger.tables.case_voice[0].language,'hi');
    const {WORKER_LANGUAGE_CODES}=await import('../server/languages.mjs');
    for(const language of WORKER_LANGUAGE_CODES){const copy=structuredClone(ledger);copy.tables.case_voice[0].language=language;validatePrivacyLedger(copy,f.baseline);}
    const invalid=structuredClone(ledger);invalid.tables.case_voice[0].language='invalid';assert.throws(()=>validatePrivacyLedger(invalid,f.baseline),/authorship/);
  }finally{await f.close();}
});
