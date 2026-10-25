import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {databaseInventory,privateObjectInventory,withBackupSnapshot,verifyRestoredInventory,quarantineRestoredDatabase} from '../server/postgres/backup.mjs';
import {withTransaction} from '../server/postgres/db.mjs';
import {backupKey,createPrivateDirectory,encryptBackupBytes,decryptBackupFile,decryptBackupBytes,
  readBackupCompletion,writeBackupCompletion,fileSha256} from '../server/backup-files.mjs';
import {postgresBackupConnection,nativeBackupSession,runNativePostgres,nativeBackupVersion} from '../server/postgres/backup-native.mjs';
import {createPostgresBackup,validatePostgresBackup,restorePostgresBackup} from '../scripts/postgres-backup.mjs';
import {encodeWav} from '../src/audio.ts';
import {localAudioStore} from '../server/private-storage.mjs';
import {Readable} from 'node:stream';

const schema='backup_test',options={schema},hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=backupKey('a7'.repeat(32)),connection={connectionString:'postgresql://operator:private-password@127.0.0.1/source'};
const wav=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
async function fixture() {
  const db=new PGlite();let failure='',snapshotCalls=0;
  const client={async query(sql,values){
    if(failure && sql.includes(failure))throw Error('Injected private failure');
    if(sql==='SELECT pg_export_snapshot() AS id'){snapshotCalls++;return {rows:[{id:'00000001-00000001-1'}]};}
    return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};
  },release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
  await db.exec(`INSERT INTO organizations(id,name) VALUES('org-a','Synthetic A'),('org-b','Synthetic B');
    INSERT INTO sites(id,org_id,name,timezone) VALUES('site-a','org-a','A','UTC'),('site-b','org-b','B','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org-a','site-a','Synthetic Owner','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','org-a','site-a','Synthetic 001','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','org-a','site-a','Synthetic shelves','Blue and yellow','ready');
    INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','org-a','site-a','brief',1,'{"facts":["Blue","Yellow"]}','published');
    INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org-a','site-a','pub','worker','en');
    INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('job','org-a','site-a','brief',1,'prepare','ready',clock_timestamp());
    INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true);
    CREATE TABLE "future""evidence"(id text PRIMARY KEY,payload jsonb);
    INSERT INTO "future""evidence" VALUES('future','{"preserved":true}');`);
  return {db,pool,get snapshotCalls(){return snapshotCalls;},fail(value){failure=value;},async close(){await db.close();}};
}
const inventory=f=>withTransaction(f.pool,async client=>({database:await databaseInventory(client,schema),objects:await privateObjectInventory(client)}));

async function privateFamilies(f,storage) {
  const ids=Object.fromEntries(['recording','retired','source','original','bundle','generated','followup','voice'].map(name=>[name,randomUUID()]));
  const digest=hash(wav),original=Buffer.from('synthetic original audio container');
  await f.db.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,received_at)
    VALUES($1,'org-a','site-a','assignment','recording-submission',$2,1,$3,'received',clock_timestamp()),
      ($4,'org-a','site-a','assignment','retired-submission',$2,1,$3,'failed',clock_timestamp())`,[ids.recording,digest,wav.length,ids.retired]);
  await f.db.query(`INSERT INTO recording_purges(recording_id,org_id,site_id,status,created_at,completed_at)
    VALUES($1,'org-a','site-a','complete',clock_timestamp(),clock_timestamp())`,[ids.retired]);
  await f.db.query(`INSERT INTO source_audio_requests(request_id,org_id,site_id,requested_by,request_hash,title,id,sha256,bytes,duration_seconds,
    original_id,original_sha256,original_bytes,original_type,authority_json,status,created_at,received_at)
    VALUES('source-request','org-a','site-a','owner',$1,'Synthetic source',$2,$3,$4,1,$5,$6,$7,'audio/wav','{}','received',clock_timestamp(),clock_timestamp())`,
  [digest,ids.source,digest,wav.length,ids.original,hash(original),original.length]);
  await f.db.query(`INSERT INTO generated_bundles(id,org_id,site_id,briefing_id,revision,job_id,job_lease,manifest_json,manifest_hash,dependency_hash,state,stored_at)
    VALUES($1,'org-a','site-a','brief',1,'job','synthetic-completed-lease','{}',$2,$2,'attached',clock_timestamp())`,[ids.bundle,'0'.repeat(64)]);
  await f.db.query(`INSERT INTO generated_audio(id,bundle_id,org_id,site_id,language,text_hash,sha256,bytes,duration_seconds)
    VALUES($1,$2,'org-a','site-a','en',$3,$4,$5,1)`,[ids.generated,ids.bundle,'0'.repeat(64),digest,wav.length]);
  await f.db.query("INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status) VALUES('case','org-a','site-a','assignment','Synthetic help','open')");
  await f.db.query(`INSERT INTO case_followups(id,org_id,site_id,case_id,assignment_id,publication_id,actor_id,actor_role,language,source_text,request_hash,
    glossary_json,status,lease_token,lease_until) VALUES('followup','org-a','site-a','case','assignment','pub','owner','owner','en','Synthetic reply',$1,'{}',
    'processing','synthetic-followup-lease',clock_timestamp()+interval '1 hour')`,[digest]);
  await f.db.query(`INSERT INTO case_followup_audio(id,request_id,org_id,site_id,job_lease,language,text_hash,sha256,bytes,duration_seconds,state)
    VALUES($1,'followup','org-a','site-a','synthetic-followup-lease','en',$2,$2,$3,1,'storing')`,[ids.followup,digest,wav.length]);
  await f.db.query("UPDATE case_followups SET status='delivered',delivered_at=clock_timestamp(),manifest_json='{}',lease_token=NULL,lease_until=NULL WHERE id='followup'");
  await f.db.query("UPDATE case_followup_audio SET state='attached' WHERE request_id='followup'");
  await f.db.query(`INSERT INTO case_voice(id,request_id,org_id,site_id,assignment_id,worker_id,kind,requested_case_id,language,sha256,bytes,duration_seconds,status,lease_token,lease_until)
    VALUES($1,'voice-message','org-a','site-a','assignment','worker','reply','case','en',$2,$3,1,'storing','voice-lease',clock_timestamp()+interval '1 hour')`,[ids.voice,digest,wav.length]);
  await f.db.query(`INSERT INTO case_messages(id,case_id,org_id,site_id,assignment_id,actor_type,actor_id,language,text,request_hash,created_at)
    VALUES('voice-message','case','org-a','site-a','assignment','worker','worker','en','[Voice message]',$1,clock_timestamp())`,[digest]);
  await f.db.query("UPDATE case_voice SET status='received',case_id='case',received_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE request_id='voice-message'");
  const refs=await withTransaction(f.pool,async client=>privateObjectInventory(client));
  for(const row of refs.filter(row=>row.retained)) {
    if(row.format==='original')await storage.saveOriginal(row,original);else await storage.save(row,wav);
  }
  return {ids,refs};
}

test('encrypted backup files authenticate content and purpose, refuse overwrites, and remove failed plaintext',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-backup-encryption-'));
  try {
    const file=join(root,'object.enc'),data=Buffer.from('private synthetic recording');
    const saved=await encryptBackupBytes(data,file,key,'object-one');
    assert.equal(saved.bytes,data.length+36);assert.equal(await fileSha256(file),saved.sha256);
    assert.equal((await decryptBackupBytes(file,key,'object-one')).toString(),data.toString());
    assert.ok(!(await readFile(file)).includes(data));
    await assert.rejects(encryptBackupBytes(data,file,key,'object-one'),/EEXIST/);
    await assert.rejects(decryptBackupBytes(file,key,'object-two'),/authentication/);
    await assert.rejects(decryptBackupBytes(file,backupKey('b8'.repeat(32)),'object-one'),/authentication/);
    const corrupt=await readFile(file);corrupt[22]^=1;await writeFile(file,corrupt);
    await assert.rejects(decryptBackupFile(file,join(root,'plain'),key,'object-one'),/authentication/);
    assert.equal((await readdir(root)).includes('plain'),false);
    await assert.rejects(createPrivateDirectory(root),/EEXIST/);
    assert.throws(()=>backupKey('not-a-key'),/256-bit/);
  }finally {await rm(root,{recursive:true,force:true});}
});

test('native tools use no shell, bounded output, private passfile, explicit TLS and secret-free errors',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-backup-native-'));let session;
  try {
    assert.throws(()=>postgresBackupConnection({connectionString:'postgresql://user:secret@remote.example/db'}),/TLS/);
    assert.throws(()=>postgresBackupConnection({connectionString:'postgresql://user:secret@remote.example/db',tls:true}),/CA/);
    assert.throws(()=>postgresBackupConnection({connectionString:'postgresql://user:secret@host-pooler.neon.tech/db',tls:true,caFile:'trusted-ca.pem'}),/direct/);
    assert.throws(()=>postgresBackupConnection({connectionString:connection.connectionString+'?sslmode=disable'}),/direct/);
    session=await nativeBackupSession(connection,root);
    assert.equal(session.env.PGPASSWORD,undefined);assert.equal(session.env.UNDERSTOOD_BACKUP_KEY,undefined);
    assert.equal((await readFile(session.env.PGPASSFILE,'utf8')).trim(),'127.0.0.1:5432:source:operator:private-password');
    const value=await runNativePostgres(process.execPath,['-e','process.stdout.write("bounded")'],{env:session.env});assert.equal(value,'bounded');
    await assert.rejects(runNativePostgres(process.execPath,['-e','process.stderr.write("private-password");process.exit(1)'],{env:session.env}),error=>!error.message.includes('private-password'));
    await assert.rejects(runNativePostgres(process.execPath,['-e','process.stdout.write("x".repeat(5000))'],{env:session.env,maxOutputBytes:100}),/Native/);
    await assert.rejects(runNativePostgres(process.execPath,['-e','setInterval(()=>{},1000)'],{env:session.env,timeoutMs:100}),/Native/);
    await assert.rejects(runNativePostgres(join(root,'missing-tool'),[],{env:session.env}),/Native/);
    assert.equal(await nativeBackupVersion('fixture',{runner:async()=> 'pg_dump (PostgreSQL) 18.0\n'}),18);
    await assert.rejects(nativeBackupVersion('fixture',{runner:async()=> 'pg_dump (PostgreSQL) 15.0\n'}),/16/);
    await session.close();session=null;assert.deepEqual(await readdir(root),[]);
  }finally {if(session)await session.close();await rm(root,{recursive:true,force:true});}
});

test('complete relational inventory includes future quoted tables, sequences, immutable definitions and detects changed data',async()=>{
  const f=await fixture();
  try {
    const before=await inventory(f);assert.ok(before.database.tables.length>80);
    assert.ok(before.database.tables.some(row=>row.name==='future"evidence' && row.count===1));
    assert.ok(before.database.sequences.some(row=>row.name==='submission_receipts_sequence_seq'));
    const verified=await verifyRestoredInventory(f.pool,before,options);assert.equal(verified.objects,0);
    await f.db.query('UPDATE "future""evidence" SET payload=$1',[JSON.stringify({changed:true})]);
    await assert.rejects(verifyRestoredInventory(f.pool,before,options),/does not match/);
    assert.equal((await f.db.query('SELECT snapshot_json FROM publications')).rows[0].snapshot_json.facts[0],'Blue');
  }finally {await f.close();}
});

test('backup snapshot checks actual job/provider pause, heartbeat and all operation leases without changing source',async()=>{
  const f=await fixture();
  try {
    const before=await inventory(f);
    await assert.rejects(withBackupSnapshot(f.pool,options,async()=>{}),/Stop all writers/);
    await f.db.query("UPDATE system_controls SET jobs_paused=false WHERE id='global'");
    await assert.rejects(withBackupSnapshot(f.pool,{...options,writersStopped:true},async()=>{}),/Pause/);
    await f.db.query("UPDATE system_controls SET jobs_paused=true WHERE id='global'");
    await f.db.query("INSERT INTO worker_health(id,state) VALUES('worker-process','busy')");
    await assert.rejects(withBackupSnapshot(f.pool,{...options,writersStopped:true},async()=>{}),/shutdown/);
    await f.db.query("UPDATE worker_health SET state='stopped' WHERE id='worker-process'");
    await f.db.query("UPDATE jobs SET status='processing',lease_token='synthetic-lease',lease_until=clock_timestamp()+interval '1 hour' WHERE id='job'");
    await assert.rejects(withBackupSnapshot(f.pool,{...options,writersStopped:true},async()=>{}),/outstanding/);
    await f.db.query("UPDATE jobs SET status='ready',lease_token=NULL,lease_until=NULL WHERE id='job'");
    const current=await inventory(f);
    const result=await withBackupSnapshot(f.pool,{...options,writersStopped:true},async snapshot=>{
      assert.deepEqual(snapshot.database,current.database);assert.equal(snapshot.snapshot,'00000001-00000001-1');return {completed:true};
    });assert.equal(result.completed,true);assert.equal(f.snapshotCalls,1);
    assert.deepEqual((await inventory(f)).database,current.database);
    assert.deepEqual(before.database.tables.find(t=>t.name==='publications'),current.database.tables.find(t=>t.name==='publications'));
  }finally {await f.close();}
});

test('quarantine is audit-atomic, revokes access, stops dispatch and preserves publication/relational evidence',async()=>{
  const f=await fixture();
  try {
    await f.db.query(`INSERT INTO worker_grants(id,org_id,site_id,worker_id,token_hash,expires_at)
      VALUES('grant','org-a','site-a','worker',$1,clock_timestamp()+interval '1 hour')`,['1'.repeat(64)]);
    await f.db.query(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,grant_id,access_mode)
      VALUES($1,'org-a','site-a','worker','worker',clock_timestamp()+interval '1 hour','grant','credential')`,['2'.repeat(64)]);
    await f.db.query(`INSERT INTO notification_events(id,org_id,site_id,audience,recipient_id,kind,object_type,object_id,dedupe_key,created_at)
      VALUES('quarantine-event','org-a','site-a','worker','worker','instruction.available','assignment','assignment','quarantine',$1)`,['2026-10-01T00:00:00.000Z']);
    await f.db.query(`INSERT INTO push_subscriptions(id,org_id,site_id,principal_type,principal_id,session_hash,endpoint_hash,endpoint,p256dh,auth,created_at,updated_at,last_seen_at)
      VALUES('quarantine-sub','org-a','site-a','worker','worker',$1,$2,'https://fcm.googleapis.com/fcm/send/quarantine',$3,$3,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
    ['2'.repeat(64),'a'.repeat(64),'x'.repeat(40)]);
    await f.db.query(`INSERT INTO push_deliveries(id,event_id,subscription_id,state,attempts,next_attempt_at,created_at,updated_at)
      VALUES('quarantine-delivery','quarantine-event','quarantine-sub','queued',0,clock_timestamp(),clock_timestamp(),clock_timestamp())`);
    await f.db.query("INSERT INTO provider_policies VALUES('global',NULL,1,true,20,clock_timestamp())");
    await f.db.query("INSERT INTO platform_operators(id,email,name,password_salt,password_hash) VALUES('operator','operator@example.test','Synthetic Operator','salt','hash')");
    await f.db.query("INSERT INTO operator_sessions VALUES('synthetic-operator-session','operator',1,clock_timestamp()+interval '1 hour',NULL)");
    await f.db.query(`INSERT INTO staff_recovery_mail(id,purpose,email_hash,payload,expires_at,state)
      VALUES('recovery-mail','reset',$1,'synthetic-private-mail',clock_timestamp()+interval '1 hour','queued')`,['4'.repeat(64)]);
    await f.db.query(`INSERT INTO staff_recovery_tokens(token_hash,mail_id,staff_id,org_id,site_id,credential_hash,expires_at)
      VALUES($1,'recovery-mail','owner','org-a','site-a',$2,clock_timestamp()+interval '1 hour')`,['5'.repeat(64),'6'.repeat(64)]);
    await f.db.query(`INSERT INTO staff_invitations(id,org_id,site_id,name,role,email_hash,email_hint,email_payload,issuer_id,
      issuer_revision,issuer_account_revision,state,revision,expires_at)
      VALUES('invitation','org-a','site-a','Synthetic invite','supervisor',$1,'s***@example.test','synthetic-payload','owner',1,1,'pending',1,clock_timestamp()+interval '1 day')`,['7'.repeat(64)]);
    await f.db.query("INSERT INTO staff_invitation_tokens(token_hash,invitation_id,generation,expires_at) VALUES('synthetic-invite-token','invitation',1,clock_timestamp()+interval '1 day')");
    await f.db.query("INSERT INTO staff_invitation_mail(id,invitation_id,generation,payload,expires_at,state) VALUES('invitation-mail','invitation',1,'synthetic-private-mail',clock_timestamp()+interval '1 day','queued')");
    await f.db.query("INSERT INTO provider_operations(id,kind,reference_id,model,data_class,reserved_requests,quota_day) VALUES('operation','connection-test','fixed-fixture','synthetic-model','synthetic',1,current_date)");
    await f.db.query("INSERT INTO provider_requests(id,operation_id,sequence,cleanup,state) VALUES('provider-request','operation',1,false,'started')");
    await f.db.query(`INSERT INTO pilot_inquiries(id,receipt_hash,request_hash,content_json,destination,state,created_at,expires_at,next_at)
      VALUES('inquiry',$1,$1,'{"name":"Synthetic contact"}','synthetic@example.test','queued',clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())`,['3'.repeat(64)]);
    const before=await inventory(f),id=randomUUID();
    f.fail('INSERT INTO audit');await assert.rejects(quarantineRestoredDatabase(f.pool,{...options,backupId:id}),/Injected/);
    f.fail('');assert.deepEqual(await inventory(f),before);
    const result=await quarantineRestoredDatabase(f.pool,{...options,backupId:id,expected:before});assert.equal(result.activationAllowed,false);
    assert.equal(result.state.format,'understood-restore-quarantine-state-v1');
    assert.equal((await f.db.query('SELECT revoked_at IS NOT NULL AS revoked FROM sessions')).rows[0].revoked,true);
    assert.deepEqual((await f.db.query("SELECT revoked_at IS NOT NULL AS revoked,revoke_reason FROM push_subscriptions WHERE id='quarantine-sub'")).rows[0],
      {revoked:true,revoke_reason:'restore_quarantine'});
    assert.deepEqual((await f.db.query("SELECT state,last_error FROM push_deliveries WHERE id='quarantine-delivery'")).rows[0],
      {state:'cancelled',last_error:'restore_quarantine'});
    assert.equal((await f.db.query('SELECT revoked_at IS NOT NULL AS revoked FROM operator_sessions')).rows[0].revoked,true);
    assert.equal((await f.db.query('SELECT revoked_at IS NOT NULL AS revoked FROM worker_grants')).rows[0].revoked,true);
    assert.equal((await f.db.query('SELECT revoked_at IS NOT NULL AS revoked FROM staff_recovery_tokens')).rows[0].revoked,true);
    assert.equal((await f.db.query('SELECT revoked_at IS NOT NULL AS revoked FROM staff_invitation_tokens')).rows[0].revoked,true);
    assert.deepEqual((await f.db.query('SELECT state,payload FROM staff_recovery_mail')).rows[0],{state:'expired',payload:null});
    assert.deepEqual((await f.db.query('SELECT state,payload FROM staff_invitation_mail')).rows[0],{state:'expired',payload:null});
    assert.deepEqual((await f.db.query('SELECT state,email_payload FROM staff_invitations')).rows[0],{state:'cancelled',email_payload:null});
    assert.equal((await f.db.query('SELECT enabled FROM provider_policies')).rows[0].enabled,false);
    assert.equal((await f.db.query('SELECT state FROM provider_requests')).rows[0].state,'uncertain');
    assert.deepEqual((await f.db.query('SELECT state,content_json,destination FROM pilot_inquiries')).rows[0],{state:'expired',content_json:null,destination:null});
    assert.deepEqual((await f.db.query('SELECT state FROM tenant_controls ORDER BY org_id')).rows.map(row=>row.state),['suspended','suspended']);
    const after=await inventory(f);assert.deepEqual(after.database.tables.find(t=>t.name==='publications'),before.database.tables.find(t=>t.name==='publications'));
    assert.deepEqual(result.state.database,after.database);assert.deepEqual(result.state.objects,after.objects);
    assert.deepEqual(after.database.tables.find(t=>t.name==='assignments'),before.database.tables.find(t=>t.name==='assignments'));
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit WHERE action='backup.restore.quarantined'")).rows[0].n,2);
  }finally {await f.close();}
});

test('locked quarantine rechecks the exact baseline and rejects unrelated deferred side effects atomically',async()=>{
  const f=await fixture();try{
    const expected=await inventory(f),backupId=randomUUID();await verifyRestoredInventory(f.pool,expected,options);
    const original=(await f.db.query('SELECT payload FROM "future""evidence"')).rows[0].payload;
    await f.db.query('UPDATE "future""evidence" SET payload=$1',[JSON.stringify({changedBetweenVerificationAndQuarantine:true})]);
    const changed=await inventory(f);
    await assert.rejects(quarantineRestoredDatabase(f.pool,{...options,backupId,expected}),/baseline does not match/);
    assert.deepEqual(await inventory(f),changed);
    await f.db.query('UPDATE "future""evidence" SET payload=$1',[JSON.stringify(original)]);
    await f.db.exec(`CREATE FUNCTION quarantine_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE "future""evidence" SET payload='{"unexpected":true}';RETURN NEW;END $$;
      CREATE CONSTRAINT TRIGGER quarantine_side_effect AFTER UPDATE ON system_controls DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION quarantine_side_effect();`);
    const guarded=await inventory(f);
    await assert.rejects(quarantineRestoredDatabase(f.pool,{...options,backupId,expected:guarded}),/unrelated restored evidence/);
    assert.deepEqual(await inventory(f),guarded);
    await assert.rejects(quarantineRestoredDatabase(f.pool,{...options,backupId,expected:{...guarded,schema:'other'}}),/scope mismatch/);
  }finally{await f.close();}
});

test('six audio families have exact encrypted coverage; completed purge is excluded and missing/corrupt source prevents completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-backup-objects-')),f=await fixture(),storage=localAudioStore(join(root,'source-audio'));
  let nativeCalls=0;
  const runner=async(tool,args,config)=>{
    if(args[0]==='--version')return 'pg_dump (PostgreSQL) 18.0\n';
    nativeCalls++;assert.ok(args.includes('--snapshot=00000001-00000001-1'));assert.equal(args.some(value=>value.includes('private-password')),false);
    return config.consume(Readable.from([Buffer.from('synthetic native archive contract fixture')]));
  };
  try {
    const {ids,refs}=await privateFamilies(f,storage);assert.equal(refs.length,7);assert.equal(refs.filter(row=>row.retained).length,6);
    assert.equal(refs.find(row=>row.id===ids.retired).retained,false);
    const before=await inventory(f),directory=join(root,'backup');
    const result=await createPostgresBackup({pool:f.pool,storage,directory,scratchDirectory:join(root,'scratch'),key,connection,...options,writersStopped:true,runner});
    assert.equal(result.complete,true);assert.equal(result.objects,6);assert.equal(nativeCalls,1);
    const manifest=validatePostgresBackup(await readBackupCompletion(directory,key));assert.equal(manifest.files.length,6);
    assert.deepEqual(manifest.database,before.database);assert.deepEqual(manifest.objects,refs);
    for(const file of manifest.files) {
      const row=refs[file.index],bytes=await decryptBackupBytes(join(directory,file.name),key,`understood:backup:${manifest.id}:object:${file.index}`,{maxBytes:row.bytes});
      assert.equal(hash(bytes),row.sha256);
    }
    assert.deepEqual(await readdir(join(root,'scratch')),[]);assert.deepEqual(await inventory(f),before);
    const changed=structuredClone(manifest);changed.files[0].name='../source-audio/object.wav';assert.throws(()=>validatePostgresBackup(changed),/coverage/);
    const duplicate=structuredClone(manifest);duplicate.objects[1].id=duplicate.objects[0].id;assert.throws(()=>validatePostgresBackup(duplicate),/inventory/);
    const uncovered=structuredClone(manifest);uncovered.files.pop();assert.throws(()=>validatePostgresBackup(uncovered),/coverage/);
    await storage.remove(refs.find(row=>row.id===ids.recording));
    await assert.rejects(createPostgresBackup({pool:f.pool,storage,directory:join(root,'missing'),scratchDirectory:join(root,'missing-scratch'),key,connection,...options,writersStopped:true,runner}));
    assert.equal((await readdir(join(root,'missing'))).includes('manifest.enc'),false);
    await storage.save(refs.find(row=>row.id===ids.recording),wav);
    const broken=Buffer.from(wav);broken[100]^=1;await writeFile(join(root,'source-audio',`${ids.recording}.wav`),broken);
    await assert.rejects(createPostgresBackup({pool:f.pool,storage,directory:join(root,'corrupt'),scratchDirectory:join(root,'corrupt-scratch'),key,connection,...options,writersStopped:true,runner}),/integrity/i);
    assert.equal((await readdir(join(root,'corrupt'))).includes('manifest.enc'),false);
  }finally {await f.close();await rm(root,{recursive:true,force:true});}
});

test('isolated physical embedded database/object restore preserves full relations and retires access without claiming native PostgreSQL execution',async()=>{
  const root=await mkdtemp(join(tmpdir(),'understood-backup-restore-')),source=await fixture(),sourceStorage=localAudioStore(join(root,'source-audio'));
  let targetDb=new PGlite(),restoreCalls=0;
  const targetPool={async connect(){return {async query(sql,values){return values?.length?targetDb.query(sql,values):(await targetDb.exec(sql)).at(-1) || {rows:[]};},release(){}};}};
  try {
    await privateFamilies(source,sourceStorage);
    const expected=await inventory(source),physical=await source.db.dumpDataDir('none'),archive=Buffer.from(await physical.arrayBuffer());
    const runner=async(tool,args,config)=>{
      if(args[0]==='--version')return `${tool} (PostgreSQL) 18.0\n`;
      if(config.consume)return config.consume(Readable.from([archive]));
      assert.ok(args.includes('--single-transaction'));assert.ok(args.includes('--exit-on-error'));assert.equal(args.includes('--clean'),false);
      const bytes=await readFile(args.at(-1));assert.equal(hash(bytes),hash(archive));
      await targetDb.close();targetDb=new PGlite({loadDataDir:new Blob([bytes])});await targetDb.waitReady;restoreCalls++;return '';
    };
    const directory=join(root,'backup');
    await createPostgresBackup({pool:source.pool,storage:sourceStorage,directory,scratchDirectory:join(root,'backup-scratch'),key,connection,...options,writersStopped:true,runner});
    const targetStorage=localAudioStore(await createPrivateDirectory(join(root,'restored-audio'))),targetConnection={connectionString:'postgresql://operator:separate-password@127.0.0.1/isolated-restore'};
    await assert.rejects(restorePostgresBackup({pool:targetPool,storage:targetStorage,directory,scratchDirectory:join(root,'not-created'),key,connection:targetConnection,runner}),/explicit/);
    const result=await restorePostgresBackup({pool:targetPool,storage:targetStorage,directory,scratchDirectory:join(root,'restore-scratch'),key,connection:targetConnection,isolatedTarget:true,trustedArchive:true,runner});
    assert.equal(restoreCalls,1);assert.equal(result.objects,6);assert.equal(result.quarantined,true);assert.equal(result.productionReady,false);
    assert.equal(result.activationAllowed,false);assert.equal(result.privacyReconciliationRequired,true);assert.equal(result.objectReadbackVerified,true);
    for(const row of expected.objects) {
      if(!row.retained)assert.equal(await targetStorage.exists(row),false);
      else assert.equal(hash(await (row.format==='original'?targetStorage.readOriginal(row):targetStorage.read(row))),row.sha256);
    }
    assert.deepEqual((await readdir(join(root,'restore-scratch'))).sort(),['quarantine-state.enc','restore-result.enc']);
    const state=JSON.parse((await decryptBackupBytes(join(root,'restore-scratch','quarantine-state.enc'),key,`understood:restore:${result.backupId}:quarantine-state`)).toString());
    assert.equal(hash(JSON.stringify(state)),result.quarantineStateSha256);
    assert.equal(state.targetIdentitySha256,hash('127.0.0.1:5432/isolated-restore'));assert.equal(state.backupId,result.backupId);
    await verifyRestoredInventory(targetPool,state,options);
    await assert.rejects(decryptBackupBytes(join(root,'restore-scratch','quarantine-state.enc'),key,`understood:restore:${result.backupId}:result`),/authentication/);
    await targetDb.query(`SET search_path TO ${schema},pg_catalog`);
    assert.equal((await targetDb.query('SELECT count(*)::int AS n FROM "future""evidence"')).rows[0].n,1);
    await assert.rejects(targetDb.query("UPDATE publications SET snapshot_json='{}'"),/immutable/);
    await assert.rejects(targetDb.query("UPDATE assignments SET worker_id='foreign'"),/immutable|foreign/i);
    await assert.rejects(restorePostgresBackup({pool:targetPool,storage:targetStorage,directory,scratchDirectory:join(root,'second-restore'),key,connection:targetConnection,isolatedTarget:true,trustedArchive:true,runner}),/empty isolated private storage/);
    assert.equal(restoreCalls,1);assert.deepEqual(await inventory(source),expected);
    await targetDb.close();targetDb=new PGlite();
    const failingStorage=localAudioStore(await createPrivateDirectory(join(root,'incomplete-audio')));
    const read=failingStorage.read;failingStorage.read=async row=>{await read(row);throw Error('Synthetic object readback interrupted');};
    await assert.rejects(restorePostgresBackup({pool:targetPool,storage:failingStorage,directory,scratchDirectory:join(root,'incomplete-scratch'),key,
      connection:targetConnection,isolatedTarget:true,trustedArchive:true,runner}),/readback interrupted/);
    assert.equal(restoreCalls,2);assert.deepEqual(await readdir(join(root,'incomplete-scratch')),[]);
    await targetDb.query(`SET search_path TO ${schema},pg_catalog`);
    assert.equal((await targetDb.query("SELECT jobs_paused AND provider_paused AS paused FROM system_controls WHERE id='global'")).rows[0].paused,true);
    assert.ok((await targetDb.query('SELECT state FROM tenant_controls')).rows.every(row=>row.state==='suspended'));
  }finally {await source.close();await targetDb.close();await rm(root,{recursive:true,force:true});}
});
