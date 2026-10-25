import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {fixtureState} from './restore-state-fixture.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {withTransaction} from '../server/postgres/db.mjs';
import {quarantineRestoredDatabase,privateObjectInventory,databaseInventory} from '../server/postgres/backup.mjs';
import {restoredRetentionState,sweepRestoredRetention} from '../server/postgres/restore-retention.mjs';
import {localAudioStore} from '../server/private-storage.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {expireStagedRecording} from '../server/postgres/recordings.mjs';
import {sweepPostgresRestore} from '../scripts/postgres-backup.mjs';
import {backupKey,createPrivateDirectory,writeBackupCompletion,decryptBackupBytes,encryptBackupBytes} from '../server/backup-files.mjs';
import {createRestoreCleanupAccounting,inspectRestoreCleanupPredecessor} from '../server/postgres/restore-cleanup-accounting.mjs';
import {requireQuarantine} from '../server/postgres/restore-retention.mjs';
import {restoreStateHash} from '../server/postgres/restore-replay-state.mjs';
import {replayPrivacyRestorePolicies} from '../scripts/postgres-privacy.mjs';
import {encodeWav} from '../src/audio.ts';
import {saveActivityRetention} from '../server/postgres/activity-retention.mjs';
import {saveBriefingRetention} from '../server/postgres/briefing-retention.mjs';
import {processOneAudioPurge} from '../server/postgres/retention.mjs';
import {exportPrivacyLedger} from '../server/postgres/privacy-ledger.mjs';

const schema='restore_test',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
const wav=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
async function fixture(){
  const db=new PGlite(),root=await mkdtemp(join(tmpdir(),'understood-restore-retention-')),storage=localAudioStore(root),backupId=randomUUID();
  let failure='',locked=false,lockConnection;
  const pool={async connect(){const client=new EventEmitter();return Object.assign(client,{async query(sql,values){
    if(sql.startsWith('SELECT pg_try_advisory_lock'))lockConnection=client;
    if(sql==='SELECT pg_export_snapshot() AS id')return {rows:[{id:'embedded-authored-snapshot'}]};
    if(failure && sql.includes(failure))throw Error('Injected private failure');
    if(locked && sql.startsWith('SELECT pg_try_advisory_lock'))return {rows:[{owned:false}]};
    return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};
  },release(){}});}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('org','Synthetic');INSERT INTO sites VALUES('site','org','Synthetic','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Synthetic','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','org','site','Synthetic worker','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','org','site','Synthetic','Synthetic shelves','ready');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','org','site','brief',1,'{"facts":["blue","yellow"]}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org','site','pub','worker','en');
    INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('job','org','site','brief',1,'prepare','ready',clock_timestamp());
    CREATE TABLE future_evidence(id text PRIMARY KEY,payload jsonb);INSERT INTO future_evidence VALUES('preserved','{"original":true}');`);
  return {db,pool,storage,root,options:{schema,backupId,isolatedTarget:true,writersStopped:true},
    fail(value){failure=value;},lock(value){locked=value;},quarantine:()=>quarantineRestoredDatabase(pool,{schema,backupId}),
    breakLock(){assert.ok(lockConnection);lockConnection.emit('error',Error('Synthetic lock connection lost'));},
    async close(){await db.close();await rm(root,{recursive:true,force:true});}};
}

test('isolated restore sweeps archived briefing content while preserving quarantine and evidence',async()=>{
  const f=await fixture();try{
    await saveBriefingRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await f.db.exec("UPDATE publications SET state='archived' WHERE id='pub';INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at) VALUES('archive','org','site','brief','{}','[\"pub\"]','owner',clock_timestamp()-interval '10 days')");
    await f.quarantine();assert.equal((await restoredRetentionState(f.pool,f.storage,f.options)).pending.briefingContent,1);
    const result=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(result.work.briefingContent,1);assert.equal(result.pending.briefingContent,0);assert.equal(result.activationAllowed,false);
    assert.equal((await f.db.query("SELECT source FROM briefings WHERE id='brief'")).rows[0].source,'[Expired]');
    assert.equal((await f.db.query("SELECT publication_id FROM assignments WHERE id='assignment'")).rows[0].publication_id,'pub');
  }finally{await f.close();}
});

test('isolated restore counts and sweeps elapsed activity identities without releasing quarantine',async()=>{
  const f=await fixture();try{
    await saveActivityRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await f.db.exec("INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES('old-private-activity','org','site','worker','worker','answer.received','PRIVATE_ITEM',clock_timestamp()-interval '10 days')");
    await f.quarantine();assert.equal((await restoredRetentionState(f.pool,f.storage,f.options)).pending.activityIdentity,1);
    const result=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(result.work.activityIdentity,1);assert.equal(result.pending.activityIdentity,0);assert.equal(result.activationAllowed,false);
    assert.deepEqual((await f.db.query("SELECT actor_id,object_id FROM audit WHERE id='old-private-activity'")).rows[0],{actor_id:'',object_id:''});
  }finally{await f.close();}
});

async function expiredFamilies(f,{policies=true}={}){
  const {db,storage}=f,ids=Object.fromEntries(['recording','source','original','bundle','generated','followup','voice'].map(key=>[key,randomUUID()])),digest=hash(wav),original=Buffer.from('Synthetic original');
  if(policies)await db.exec(`INSERT INTO retention_policies VALUES('site','org',1,7,clock_timestamp());
    INSERT INTO text_retention_policies VALUES('site','org',1,7,clock_timestamp());
    INSERT INTO case_retention_policies VALUES('site','org',1,7,clock_timestamp());
    INSERT INTO generated_retention_policies VALUES('site','org',1,7,clock_timestamp());`);
  await db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,received_at,transcript)
    VALUES($1,'org','site','assignment','recorded',$2,1,$3,'received',clock_timestamp()-interval '10 days','Synthetic transcript')`,[ids.recording,digest,wav.length]);
  await db.exec(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,received_at,outcome,assessment_status,reasons_json,evidence_json)
    VALUES('answer','org','site','assignment','typed','Synthetic answer',clock_timestamp()-interval '10 days','matched','complete','["synthetic"]','[]');`);
  // Authored past-resolution fixture, not evidence of a historical user workflow.
  await db.exec('ALTER TABLE clarifications DISABLE TRIGGER case_resolution_clock');
  await db.exec(`
    INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,notes,status,resolved_at)
      VALUES('case','org','site','assignment','Synthetic reason','Synthetic notes','resolved',clock_timestamp()-interval '10 days');`);
  await db.exec('ALTER TABLE clarifications ENABLE TRIGGER case_resolution_clock');
  await db.exec(`
    INSERT INTO case_messages(id,case_id,org_id,site_id,assignment_id,actor_type,actor_id,language,text,request_hash,created_at)
      VALUES('message','case','org','site','assignment','worker','worker','en','Synthetic message','${digest}',clock_timestamp()-interval '10 days');`);
  await db.query(`INSERT INTO source_audio_requests(request_id,org_id,site_id,requested_by,request_hash,title,id,sha256,bytes,duration_seconds,
    original_id,original_sha256,original_bytes,original_type,authority_json,status,created_at,received_at)
    VALUES('source-request','org','site','owner',$1,'Synthetic source',$2,$1,$3,1,$4,$5,$6,'audio/wav','{}','received',clock_timestamp()-interval '10 days',clock_timestamp()-interval '10 days')`,
    [digest,ids.source,wav.length,ids.original,hash(original),original.length]);
  await db.query(`INSERT INTO generated_bundles(id,org_id,site_id,briefing_id,revision,job_id,job_lease,manifest_json,manifest_hash,dependency_hash,state,stored_at)
    VALUES($1,'org','site','brief',1,'job','synthetic-job','{}',$2,$2,'attached',clock_timestamp()-interval '10 days')`,[ids.bundle,'0'.repeat(64)]);
  await db.query(`INSERT INTO generated_audio(id,bundle_id,org_id,site_id,language,text_hash,sha256,bytes,duration_seconds)
    VALUES($1,$2,'org','site','en',$3,$4,$5,1)`,[ids.generated,ids.bundle,'0'.repeat(64),digest,wav.length]);
  await db.query(`INSERT INTO case_followups(id,org_id,site_id,case_id,assignment_id,publication_id,actor_id,actor_role,language,source_text,request_hash,
    glossary_json,status,lease_token,lease_until,created_at) VALUES('followup','org','site','case','assignment','pub','owner','owner','en','Synthetic reply',$1,'{}',
    'processing','synthetic-followup',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '10 days')`,[digest]);
  await db.query(`INSERT INTO case_followup_audio(id,request_id,org_id,site_id,job_lease,language,text_hash,sha256,bytes,duration_seconds,state)
    VALUES($1,'followup','org','site','synthetic-followup','en',$2,$2,$3,1,'storing')`,[ids.followup,digest,wav.length]);
  await db.exec("UPDATE case_followups SET status='delivered',delivered_at=clock_timestamp()-interval '10 days',manifest_json='{}',lease_token=NULL,lease_until=NULL WHERE id='followup';UPDATE case_followup_audio SET state='attached' WHERE request_id='followup'");
  await db.query(`INSERT INTO case_voice(id,request_id,org_id,site_id,assignment_id,worker_id,kind,requested_case_id,language,sha256,bytes,duration_seconds,status,lease_token,lease_until,created_at)
    VALUES($1,'voice','org','site','assignment','worker','reply','case','en',$2,$3,1,'storing','voice-lease',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '10 days')`,[ids.voice,digest,wav.length]);
  await db.query(`INSERT INTO case_messages(id,case_id,org_id,site_id,assignment_id,actor_type,actor_id,language,text,request_hash,created_at)
    VALUES('voice','case','org','site','assignment','worker','worker','en','[Voice message]',$1,clock_timestamp()-interval '10 days')`,[digest]);
  await db.exec("UPDATE case_voice SET status='received',case_id='case',received_at=clock_timestamp()-interval '10 days',lease_token=NULL,lease_until=NULL WHERE request_id='voice'");
  for(const ref of await withTransaction(f.pool,client=>privateObjectInventory(client))){
    if(ref.format==='original')await storage.saveOriginal(ref,original);else await storage.save(ref,wav);
  }
  return ids;
}

test('restore sweep removes all six expired private families and text without changing publication evidence or releasing quarantine',async()=>{
  const f=await fixture();try{
    await expiredFamilies(f);await f.quarantine();
    const before=(await f.db.query('SELECT * FROM publications')).rows,assignments=(await f.db.query('SELECT * FROM assignments')).rows;
    const state=await restoredRetentionState(f.pool,f.storage,f.options);
    for(const name of ['recordingAudio','sourceAudio','attemptText','recordingText','resolvedCaseText','generatedAudio','followupAudio','caseVoice'])assert.equal(state.pending[name],1,name);
    const result=await sweepRestoredRetention(f.pool,f.storage,f.options);
    assert.equal(result.stop,'reconciled');assert.equal(result.elapsedPoliciesReconciled,true);assert.equal(result.pendingCount,0);
    assert.equal(result.retiredObjects,6);assert.equal(result.unverifiedObjects,0);
    assert.equal(result.activationAllowed,false);assert.equal(result.productionReady,false);assert.equal(result.authoritativePrivacyReconciliation,'required');
    assert.deepEqual((await f.db.query('SELECT * FROM publications')).rows,before);assert.deepEqual((await f.db.query('SELECT * FROM assignments')).rows,assignments);
    assert.equal((await f.db.query('SELECT answer_text,outcome FROM attempts')).rows[0].answer_text,'[Expired]');
    assert.equal((await f.db.query('SELECT outcome FROM attempts')).rows[0].outcome,'matched');
    assert.equal((await f.db.query('SELECT transcript FROM recordings')).rows[0].transcript,null);
    assert.equal((await f.db.query('SELECT reason,notes FROM clarifications')).rows[0].reason,'[Expired]');
    assert.equal((await f.db.query('SELECT source_text FROM case_followups')).rows[0].source_text,'[Expired]');
    assert.equal((await f.db.query('SELECT state FROM generated_bundles')).rows[0].state,'cleaned');
    assert.equal(await f.storage.isEmpty(),true);
    assert.equal((await f.db.query('SELECT state FROM tenant_controls')).rows[0].state,'suspended');
    assert.equal((await f.db.query("SELECT payload FROM future_evidence")).rows[0].payload.original,true);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit WHERE action='backup.restore.elapsed_policies_reconciled'")).rows[0].n,1);
    const repeat=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(repeat.cycles,0);assert.equal(repeat.stop,'reconciled');
  }finally{await f.close();}
});

test('authored lock-connection loss stops further private removals and never certifies restore cleanup',async()=>{
  const f=await fixture();try{
    await expiredFamilies(f);await f.quarantine();let removals=0;
    const storage={...f.storage,async remove(row){removals++;await f.storage.remove(row);f.breakLock();}};
    await assert.rejects(sweepRestoredRetention(f.pool,storage,f.options),error=>error.code==='UNDERSTOOD_PG_CONNECTION_LOST');
    assert.equal(removals,1);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit WHERE action='backup.restore.elapsed_policies_reconciled'")).rows[0].n,0);
    const state=await restoredRetentionState(f.pool,f.storage,f.options);
    assert.equal(state.activationAllowed,false);assert.equal(state.elapsedPoliciesReconciled,false);assert.ok(state.pendingCount>0);
    await withTransaction(f.pool,client=>requireQuarantine(client,f.options.backupId));
  }finally{await f.close();}
});

test('restore sweep refuses missing confirmations, wrong restore identity, active access and a concurrent sweep before cleanup',async()=>{
  const f=await fixture();try{
    await expiredFamilies(f);
    const before=await withTransaction(f.pool,client=>databaseInventory(client,schema));
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,{...f.options,isolatedTarget:false}),/stopped isolated/);
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,{...f.options,writersStopped:false}),/stopped isolated/);
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,{...f.options,maxCycles:0}),/bounds/);
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,f.options),/quarantine required/);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
    await f.quarantine();
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,{...f.options,backupId:randomUUID()}),/not quarantined/);
    f.lock(true);await assert.rejects(sweepRestoredRetention(f.pool,f.storage,f.options),/already running/);f.lock(false);
    await f.db.exec("UPDATE system_controls SET provider_paused=false WHERE id='global'");
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,f.options),/quarantine required/);
    assert.equal(await f.storage.isEmpty(),false);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM recording_purges')).rows[0].n,0);
  }finally{await f.close();}
});

test('failed removal, future retries, absence errors and expired cleanup claims never certify an elapsed-policy sweep',async()=>{
  const f=await fixture();try{
    await expiredFamilies(f);await f.quarantine();
    const failed={...f.storage,async remove(){},async removeOriginal(){}};
    const result=await sweepRestoredRetention(f.pool,failed,{...f.options,maxCycles:1});
    assert.equal(result.elapsedPoliciesReconciled,false);assert.equal(result.stop,'bounded');assert.ok(result.pendingCount>0);assert.ok(result.unverifiedObjects>0);
    const waiting=await sweepRestoredRetention(f.pool,failed,f.options);assert.equal(waiting.stop,'waiting');assert.equal(waiting.elapsedPoliciesReconciled,false);
    assert.equal((await f.db.query('SELECT status FROM recording_purges')).rows[0].status,'queued');
    await f.db.exec("UPDATE recording_purges SET retry_at=clock_timestamp()-interval '1 second';UPDATE source_audio_purges SET retry_at=clock_timestamp()-interval '1 second';UPDATE generated_bundles SET cleanup_until=clock_timestamp()-interval '1 second' WHERE state='cleaning';UPDATE case_followup_audio SET cleanup_until=clock_timestamp()-interval '1 second' WHERE state='cleaning';UPDATE case_voice SET cleanup_until=clock_timestamp()-interval '1 second' WHERE cleanup_state='cleaning'");
    const recovered=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(recovered.elapsedPoliciesReconciled,true);
    const uncertain=await restoredRetentionState(f.pool,{...f.storage,async exists(){throw Error('No storage verdict');}},f.options);
    assert.equal(uncertain.elapsedPoliciesReconciled,false);assert.equal(uncertain.unverifiedObjects,5);
    const unknown=await restoredRetentionState(f.pool,{...f.storage,async exists(){return undefined;}},f.options);assert.equal(unknown.elapsedPoliciesReconciled,false);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit WHERE action='backup.restore.elapsed_policies_reconciled'")).rows[0].n,1);
  }finally{await f.close();}
});

test('disabled policies preserve old content while an existing worker deletion completes through the restored sweep',async()=>{
  const f=await fixture();try{
    await expiredFamilies(f,{policies:false});await f.quarantine();
    const preserved=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(preserved.stop,'reconciled');assert.equal(preserved.retiredObjects,0);
    assert.equal((await f.db.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'Synthetic answer');assert.equal(await f.storage.isEmpty(),false);
    const missing=await restoredRetentionState(f.pool,{...f.storage,async read(){throw Error('Wrong namespace');}},f.options);
    assert.equal(missing.elapsedPoliciesReconciled,false);assert.equal(missing.unverifiedRetainedObjects,5);
    const corrupt=await restoredRetentionState(f.pool,{...f.storage,async read(){return Buffer.from('Corrupt object');}},f.options);
    assert.equal(corrupt.elapsedPoliciesReconciled,false);assert.equal(corrupt.unverifiedRetainedObjects,5);
    // Build a distinct pre-quarantine deletion fixture using the normal authorized operation.
  }finally{await f.close();}
  const deleted=await fixture();try{
    const ids=await expiredFamilies(deleted,{policies:false});
    await requestWorkerDeletion(deleted.pool,owner,'worker',{requestId:randomUUID(),expectedCode:'Synthetic worker',reason:'worker_request',confirmed:true},{schema});
    await deleted.quarantine();
    const result=await sweepRestoredRetention(deleted.pool,deleted.storage,deleted.options);
    assert.equal(result.elapsedPoliciesReconciled,true);assert.equal(result.pending.workerDeletion,0);
    assert.equal(result.retiredObjects,3);assert.equal(result.unverifiedObjects,0);
    assert.equal((await deleted.db.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'[Deleted]');
    assert.equal((await deleted.db.query('SELECT count(*)::int AS n FROM worker_deletion_completions')).rows[0].n,1);
    assert.equal(await deleted.storage.exists({id:ids.recording,org_id:'org',site_id:'site'}),false);
    assert.equal(await deleted.storage.exists({id:ids.generated,org_id:'org',site_id:'site'}),true);
  }finally{await deleted.close();}
});

test('restore retention command binds encrypted results to the backup and never accepts the original database or reuses output',async()=>{
  const f=await fixture(),key=backupKey('d9'.repeat(32));try{
    await f.quarantine();
    const directory=await createPrivateDirectory(join(f.root,'backup'));
    // Minimal authored encrypted manifest tests command admission, not native restore transport.
    const manifest={format:'understood-postgres-private-backup-v1',id:f.options.backupId,createdAt:new Date().toISOString(),schema,toolVersion:16,
      sourceIdentitySha256:hash('127.0.0.1:5432/source'),database:await withTransaction(f.pool,client=>databaseInventory(client,schema)),
      objects:[],files:[],archive:{name:'database.enc',bytes:100,sha256:'c'.repeat(64)}};
    await writeBackupCompletion(directory,manifest,key);
    const ledgerDirectory=await createPrivateDirectory(join(f.root,'ledger'));
    await writeBackupCompletion(ledgerDirectory,await exportPrivacyLedger(f.pool,manifest,{schema,sourceIdentitySha256:manifest.sourceIdentitySha256,writersStopped:true}),key);
    const args={...await fixtureState({root:f.root,targetPool:f.pool,baseline:manifest},key),pool:f.pool,storage:f.storage,directory,ledgerDirectory,scratchDirectory:join(f.root,'result'),key,connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},isolatedTarget:true,writersStopped:true};
    await assert.rejects(sweepPostgresRestore({...args,isolatedTarget:false}),/stopped writers/);
    await assert.rejects(sweepPostgresRestore({...args,connection:{connectionString:'postgresql://operator:private@127.0.0.1/source'}}),/source database/);
    await assert.rejects(sweepPostgresRestore({...args,ledgerDirectory:undefined}),/acceptance\/privacy ledger/);
    const result=await sweepPostgresRestore(args);assert.equal(result.elapsedPoliciesReconciled,true);assert.equal(result.activationAllowed,false);
    const saved=JSON.parse((await decryptBackupBytes(join(args.scratchDirectory,'retention-result.enc'),key,`understood:restore:${manifest.id}:retention`)).toString('utf8'));
    assert.deepEqual(saved,result);assert.equal(saved.authoritativePrivacyReconciliation,'required');
    await assert.rejects(decryptBackupBytes(join(args.scratchDirectory,'retention-result.enc'),key,`understood:restore:${randomUUID()}:retention`),/authentication/);
    await assert.rejects(sweepPostgresRestore(args),/EEXIST/);
  }finally{key.fill(0);await f.close();}
});

test('staged recording acknowledgement without absence or a live lease remains retryable, with no accepted answer',async()=>{
  const f=await fixture();try{
    const id=randomUUID(),ref={id,org_id:'org',site_id:'site',sha256:hash(wav),bytes:wav.length};
    await f.db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,lease_token,lease_until)
      VALUES($1,'org','site','assignment','interrupted',$2,1,$3,'storing','old-lease',clock_timestamp()-interval '1 second')`,[id,hash(wav),wav.length]);
    await f.storage.save(ref,wav);await f.quarantine();
    await expireStagedRecording(f.pool,{...f.storage,async remove(){}},{schema});
    assert.equal((await f.db.query('SELECT status FROM recordings')).rows[0].status,'storing');
    await f.db.exec("UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second'");
    await expireStagedRecording(f.pool,{...f.storage,async exists(){await f.db.exec("UPDATE recordings SET lease_until=clock_timestamp()-interval '1 second'");return false;}},{schema});
    assert.equal((await f.db.query('SELECT status FROM recordings')).rows[0].status,'storing');
    const result=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(result.stop,'reconciled');
    assert.equal((await f.db.query('SELECT status FROM recordings')).rows[0].status,'failed');assert.equal(await f.storage.exists(ref),false);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM submission_receipts')).rows[0].n,0);
  }finally{await f.close();}
});

test('cleanup stage and audit errors remain explicit and cannot produce a successful sweep result',async()=>{
  const f=await fixture();try{
    await expiredFamilies(f);await f.quarantine();f.fail('INSERT INTO text_retention_purges');
    const result=await sweepRestoredRetention(f.pool,f.storage,f.options);
    assert.equal(result.elapsedPoliciesReconciled,false);assert.ok(result.failedStages.includes('attemptText'));assert.ok(result.failedStages.includes('recordingText'));
    f.fail('backup.restore.elapsed_policies_reconciled');
    await assert.rejects(sweepRestoredRetention(f.pool,f.storage,f.options),/Injected/);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit WHERE action='backup.restore.elapsed_policies_reconciled'")).rows[0].n,0);
    f.fail('');const recovered=await sweepRestoredRetention(f.pool,f.storage,f.options);assert.equal(recovered.stop,'reconciled');
  }finally{await f.close();}
});

async function accountedCleanup(f,key,{families=true}={}){
  if(families){await expiredFamilies(f);
    await f.db.exec(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      SELECT org_id,assignment_id,submission_id,'typed',received_at FROM attempts;
      INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      SELECT org_id,assignment_id,submission_id,'audio',received_at FROM recordings WHERE received_at IS NOT NULL;`);
  }
  await f.db.exec("INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true)");
  const before=await withTransaction(f.pool,async client=>({database:await databaseInventory(client,schema),objects:await privateObjectInventory(client)}));
  const baseline={format:'understood-postgres-private-backup-v1',id:f.options.backupId,createdAt:new Date().toISOString(),schema,toolVersion:16,
    sourceIdentitySha256:hash('127.0.0.1:5432/source'),...before,archive:{name:'database.enc',bytes:100,sha256:'c'.repeat(64)},
    files:before.objects.filter(row=>row.retained).map(row=>({index:before.objects.indexOf(row),name:`object-${before.objects.indexOf(row)}.enc`,bytes:row.bytes+36,sha256:'b'.repeat(64)}))};
  const ledger=await exportPrivacyLedger(f.pool,baseline,{schema,sourceIdentitySha256:baseline.sourceIdentitySha256,writersStopped:true});
  const {state}=await quarantineRestoredDatabase(f.pool,{schema,backupId:baseline.id,expected:baseline});
  state.targetIdentitySha256=hash('127.0.0.1:5432/restored');
  const directory=await createPrivateDirectory(join(f.root,'accounted-backup')),ledgerDirectory=await createPrivateDirectory(join(f.root,'accounted-ledger'));
  await writeBackupCompletion(directory,baseline,key);await writeBackupCompletion(ledgerDirectory,ledger,key);
  const stateFile=join(f.root,'accounted-quarantine.enc');
  await encryptBackupBytes(Buffer.from(JSON.stringify(state)),stateFile,key,`understood:restore:${baseline.id}:quarantine-state`);
  const args={pool:f.pool,storage:f.storage,directory,ledgerDirectory,stateFile,stateKind:'quarantine',scratchDirectory:join(f.root,'accounted-result'),key,maxMilliseconds:300000,
    connection:{connectionString:'postgresql://operator:private@127.0.0.1/restored'},isolatedTarget:true,writersStopped:true};
  return {args,baseline,ledger,state};
}

test('accounted production cleanup chains each commit and all six removals, preserves evidence and verifies successor on resume',async()=>{
  const f=await fixture(),key=backupKey('e4'.repeat(32));try{
    const {args,baseline,state}=await accountedCleanup(f,key),publications=(await f.db.query('SELECT * FROM publications')).rows;
    const result=await sweepPostgresRestore(args);assert.equal(result.elapsedPoliciesReconciled,true,JSON.stringify({stop:result.stop,failedStages:result.failedStages,pendingCount:result.pendingCount,work:result.work}));
    assert.equal(result.cleanupState.removedObjects.length,6);assert.equal(result.activationAllowed,false);
    assert.deepEqual((await f.db.query('SELECT * FROM publications')).rows,publications);
    assert.equal((await f.db.query('SELECT outcome FROM attempts')).rows[0].outcome,'matched');
    const files=(await readdir(args.scratchDirectory)).filter(name=>name.endsWith('-state.enc')).sort();
    let previous=state,removed=0;
    for(const file of files){const current=JSON.parse((await decryptBackupBytes(join(args.scratchDirectory,file),key,`understood:restore:${baseline.id}:cleanup-state`)).toString());
      assert.equal(current.predecessorStateSha256,restoreStateHash(previous));assert.equal(current.productionReady,false);
      if(current.kind==='removal')removed++;previous=current;
    }
    assert.equal(removed,6);assert.deepEqual(previous,result.cleanupState);
    const resumed=await sweepPostgresRestore({...args,stateFile:join(args.scratchDirectory,files.at(-1)),stateKind:'cleanup',scratchDirectory:join(f.root,'accounted-resumed')});
    assert.equal(resumed.elapsedPoliciesReconciled,true);assert.equal(resumed.cycles,0);
    const beforeRejected=await withTransaction(f.pool,client=>databaseInventory(client,schema));
    const rejectedDirectory=join(f.root,'rejected-cross-phase');
    await assert.rejects(replayPrivacyRestorePolicies({pool:f.pool,connection:args.connection,backupDirectory:args.directory,ledgerDirectory:args.ledgerDirectory,
      stateFile:join(args.scratchDirectory,files.at(-1)),stateKind:'cleanup',directory:rejectedDirectory,key,confirmed:true,isolatedTarget:true,writersStopped:true}),/cross-phase reconciliation/);
    await assert.rejects(readdir(rejectedDirectory),/ENOENT/);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),beforeRejected);
    // A checkpoint without matching original ledger admission never waives input gaps.
    const invalidAdmission={...resumed.cleanupState,admission:{...resumed.cleanupState.admission,ledgerFingerprint:'0'.repeat(64)}};
    const invalidStateFile=join(f.root,'invalid-admission.enc');
    await encryptBackupBytes(Buffer.from(JSON.stringify(invalidAdmission)),invalidStateFile,key,`understood:restore:${baseline.id}:cleanup-state`);
    const rejected=await sweepPostgresRestore({...args,stateFile:invalidStateFile,stateKind:'cleanup',scratchDirectory:join(f.root,'invalid-admission-result')});
    assert.equal(rejected.elapsedPoliciesReconciled,false);assert.ok(rejected.unaccountedInputGapCount>0);assert.equal(rejected.cycles,0);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),beforeRejected);
    await f.db.exec("UPDATE future_evidence SET payload='{}'");
    const resumedFiles=(await readdir(join(f.root,'accounted-resumed'))).filter(name=>name.endsWith('-state.enc')).sort();
    await assert.rejects(sweepPostgresRestore({...args,stateFile:join(f.root,'accounted-resumed',resumedFiles.at(-1)),stateKind:'cleanup',scratchDirectory:join(f.root,'drifted')}),/predecessor state/);
  }finally{key.fill(0);await f.close();}
});

test('accounted cleanup never removes a retained object and persistence failure rolls back database work',async()=>{
  const f=await fixture(),key=backupKey('e3'.repeat(32));try{
    const {baseline,ledger,state}=await accountedCleanup(f,key),events=[];
    const options={pool:f.pool,storage:f.storage,baseline,ledger,predecessor:state,targetIdentitySha256:state.targetIdentitySha256,requireQuarantine,
      persist:async event=>{events.push(event);}};
    const accounting=await createRestoreCleanupAccounting(options),reference=state.objects.find(row=>row.family==='recording');
    await assert.rejects(accounting.run('recordingAudio',(_,storage)=>storage.remove(reference)),/retired reference/);
    assert.equal(await f.storage.exists(reference),true);assert.equal(events.length,1);
    const before=await withTransaction(f.pool,client=>databaseInventory(client,schema));
    const failed=await createRestoreCleanupAccounting({...options,persist:async event=>{if(event.kind==='state')throw Error('Injected checkpoint persistence failure');}});
    await assert.rejects(failed.run('recordingAudio',pool=>withTransaction(pool,client=>client.query("UPDATE recordings SET error='Synthetic change'"))),/checkpoint persistence/);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
    await assert.rejects(failed.verify(),/stopped after/);
    const immutable=await createRestoreCleanupAccounting(options);
    await assert.rejects(immutable.run('attemptText',pool=>withTransaction(pool,client=>client.query("UPDATE attempts SET outcome='clarification'"))),/immutable/i);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
    const directoryGuard=await createRestoreCleanupAccounting(options);
    await assert.rejects(directoryGuard.run('deletionPseudonym',pool=>withTransaction(pool,client=>client.query("UPDATE workers SET language='ar'"))),/immutable accepted input/);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
  }finally{key.fill(0);await f.close();}
});

test('lost cleanup commit acknowledgement recovers exact candidate but missing transition receipts cannot certify recovery',async()=>{
  const f=await fixture(),key=backupKey('e2'.repeat(32));try{
    const {baseline,ledger,state}=await accountedCleanup(f,key),events=[];
    const options={pool:f.pool,storage:f.storage,baseline,ledger,predecessor:state,targetIdentitySha256:state.targetIdentitySha256,requireQuarantine};
    const accounting=await createRestoreCleanupAccounting({...options,persist:async event=>{events.push(event);if(event.kind==='ack')throw Error('Injected lost ack');}});
    await assert.rejects(accounting.run('recordingAudio',pool=>withTransaction(pool,client=>client.query("UPDATE recordings SET error='Accounted change'"))),/lost ack/);
    const candidate=events.find(event=>event.kind==='state').value;
    await inspectRestoreCleanupPredecessor({...options,predecessor:candidate});
    await assert.rejects(inspectRestoreCleanupPredecessor(options),/predecessor state/);
    const invalid={...candidate,transitionId:randomUUID()};
    await assert.rejects(inspectRestoreCleanupPredecessor({...options,predecessor:invalid}),/committed audit/);
    const recovered=await createRestoreCleanupAccounting({...options,predecessor:candidate,persist:async()=>{}});
    assert.deepEqual(await recovered.verify(),candidate);
  }finally{key.fill(0);await f.close();}
});

test('accounted removal failure preserves durable intent and actual absence, stops subsequent commits and recovers without a second removal',async()=>{
  const f=await fixture(),key=backupKey('e1'.repeat(32));try{
    const {baseline,ledger,state}=await accountedCleanup(f,key),events=[];let calls=0;
    const uncertain={...f.storage,async remove(row){calls++;await f.storage.remove(row);throw Error('Lost removal acknowledgement');}};
    const options={pool:f.pool,storage:uncertain,baseline,ledger,predecessor:state,targetIdentitySha256:state.targetIdentitySha256,requireQuarantine,
      persist:async event=>{events.push(event);}};
    const accounting=await createRestoreCleanupAccounting(options);
    await assert.rejects(accounting.run('recordingAudio',(pool,storage)=>processOneAudioPurge(pool,storage,{schema})),/stopped after/);
    const reference=state.objects.find(row=>row.family==='recording'),intent=events.find(event=>event.kind==='removal-intent').value;
    assert.equal(await f.storage.exists(reference),false);assert.equal(intent.present,true);assert.equal(calls,1);
    assert.equal((await f.db.query('SELECT status FROM recording_purges')).rows[0].status,'processing');
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit WHERE action='recording.audio.purged'")).rows[0].n,0);
    const committed=events.filter(event=>event.kind==='state').at(-1).value;
    const recoveredEvents=[],recovered=await createRestoreCleanupAccounting({...options,predecessor:committed,persist:async event=>{recoveredEvents.push(event);}});
    await recovered.run('recordingAudio',(_,storage)=>storage.remove({...reference,retained:undefined}));
    assert.equal(calls,1);assert.equal(recoveredEvents.find(event=>event.kind==='removal-intent').value.present,false);
    const successor=await recovered.verify();assert.equal(successor.removedObjects.length,1);
    await f.storage.save(reference,wav);
    await assert.rejects(inspectRestoreCleanupPredecessor({...options,predecessor:successor}),/absence is no longer verified/);
  }finally{key.fill(0);await f.close();}
});

test('deferred cleanup trigger drift rolls back before any private removal and rolled-back commit candidates cannot certify recovery',async()=>{
  const f=await fixture(),key=backupKey('e0'.repeat(32));try{
    await f.db.exec(`CREATE FUNCTION bad_cleanup_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.error='Audio retention expired' THEN UPDATE future_evidence SET payload='{}'; END IF; RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER bad_cleanup_deferred AFTER UPDATE ON recordings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bad_cleanup_side_effect();`);
    const {baseline,ledger,state}=await accountedCleanup(f,key),events=[];let calls=0;
    const options={pool:f.pool,storage:{...f.storage,async remove(row){calls++;return f.storage.remove(row);}},baseline,ledger,predecessor:state,
      targetIdentitySha256:state.targetIdentitySha256,requireQuarantine,persist:async event=>{events.push(event);}};
    const accounting=await createRestoreCleanupAccounting(options),before=await withTransaction(f.pool,client=>databaseInventory(client,schema));
    await assert.rejects(accounting.run('recordingAudio',(pool,storage)=>processOneAudioPurge(pool,storage,{schema})),/unaccounted database/);
    assert.equal(calls,0);assert.equal(events.length,1);assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
    const failurePool={async connect(){const client=await f.pool.connect();let armed=false;return {async query(sql,args){
      if(sql==='SET CONSTRAINTS ALL IMMEDIATE')armed=true;if(armed && sql==='COMMIT')throw Error('Injected cleanup commit failure');return client.query(sql,args);},release(){client.release();}};}};
    const second=await createRestoreCleanupAccounting({...options,pool:failurePool});
    await assert.rejects(second.run('recordingAudio',pool=>withTransaction(pool,client=>client.query("UPDATE recordings SET error='Synthetic accounted change'"))),/cleanup commit failure/);
    const candidate=events.find(event=>event.kind==='state').value;
    await assert.rejects(inspectRestoreCleanupPredecessor({...options,predecessor:candidate}),/predecessor state/);
    assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
  }finally{key.fill(0);await f.close();}
});

test('accounted production sweep covers activity/archived briefing transformations and original worker deletion without broadening mutable columns',async()=>{
  const f=await fixture(),key=backupKey('df'.repeat(32));try{
    await saveBriefingRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await saveActivityRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:7,confirmed:true},{schema});
    await f.db.exec(`UPDATE publications SET state='archived' WHERE id='pub';
      INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by,occurred_at)
      VALUES('archive','org','site','brief','{}','["pub"]','owner',clock_timestamp()-interval '10 days');
      INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at)
      VALUES('old-private-event','org','site','worker','worker','answer.received','item',clock_timestamp()-interval '10 days');`);
    const {args}=await accountedCleanup(f,key,{families:false});
    const result=await sweepPostgresRestore(args);assert.equal(result.elapsedPoliciesReconciled,true);
    assert.equal(result.work.activityIdentity,1);assert.equal(result.work.briefingContent,1);
    assert.equal((await f.db.query('SELECT source FROM briefings')).rows[0].source,'[Expired]');
    assert.equal((await f.db.query('SELECT state FROM publications')).rows[0].state,'archived');
  }finally{key.fill(0);await f.close();}
  const g=await fixture(),key2=backupKey('de'.repeat(32));try{
    await expiredFamilies(g);
    await g.db.exec(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      SELECT org_id,assignment_id,submission_id,'typed',received_at FROM attempts;
      INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      SELECT org_id,assignment_id,submission_id,'audio',received_at FROM recordings;`);
    await requestWorkerDeletion(g.pool,owner,'worker',{requestId:randomUUID(),expectedCode:'Synthetic worker',reason:'worker_request',confirmed:true},{schema});
    const {args}=await accountedCleanup(g,key2,{families:false});
    const result=await sweepPostgresRestore(args);assert.equal(result.elapsedPoliciesReconciled,true);
    assert.equal(result.work.deletionRedaction,1);assert.equal(result.work.deletionPseudonym,1);assert.equal(result.work.deletionCompletion,1);
    assert.equal((await g.db.query('SELECT outcome FROM attempts')).rows[0].outcome,'matched');
    assert.equal((await g.db.query('SELECT answer_text FROM attempts')).rows[0].answer_text,'[Deleted]');
  }finally{key2.fill(0);await g.close();}
});
