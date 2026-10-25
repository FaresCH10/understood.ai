import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions,runtimeRoleName,runtimeTablePolicy,runtimeProfile,fenceSourceRuntime,inspectSourceRuntimeFence} from '../server/postgres/runtime-permissions.mjs';
import {withTransaction} from '../server/postgres/db.mjs';
import {databaseInventory} from '../server/postgres/backup.mjs';
import {submitAnswer,domainTransaction} from '../server/postgres/domain.mjs';
import {runRehearsalWorker,rehearsalTasks,runWorkerCycle} from '../server/postgres/runtime.mjs';
import {randomUUID} from 'node:crypto';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {changeTemplate} from '../server/postgres/templates.mjs';
import {changeGlossary,readGlossarySnapshot} from '../server/postgres/glossary.mjs';
import {processOnePreparation,createDraft,requestPreparation} from '../server/postgres/preparation.mjs';
import {requireTenantActive} from '../server/postgres/operations-gates.mjs';
import {requireWorkerSiteAccess} from '../server/postgres/site-access.mjs';
import {inspectRuntimeUpdateColumns} from '../server/postgres/runtime-column-permissions.mjs';
import {createSchedule} from '../server/postgres/schedules.mjs';
import {saveTextRetention} from '../server/postgres/text-retention.mjs';
import {provisionStaffCredential,authenticateStaff} from '../server/postgres/auth.mjs';
import {resolveMailConfig} from '../server/auth-mail.mjs';
import {requestRecovery,processOneRecovery,resetPassword} from '../server/postgres/account-recovery.mjs';
import {issueInvitation,processOneInvitation,acceptInvitation} from '../server/postgres/invitations.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {saveCaseReview,caseReviewReceipt} from '../server/postgres/case-reviews.mjs';
import {requestCaseRepeat,caseRepeatReceipt} from '../server/postgres/case-repeats.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {processOneDeletionRedaction} from '../server/postgres/deletion-redactions.mjs';
import {saveCaseRetention,processOneCaseContentPurge} from '../server/postgres/case-retention.mjs';
import {getClarification} from '../server/postgres/clarifications.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {processOneRecording} from '../server/postgres/recording-worker.mjs';
import {processOneAudioPurge} from '../server/postgres/retention.mjs';
import {encodeWav} from '../src/audio.ts';
import {caseWorkflowUpdates} from '../server/postgres/case-workflow-permissions.mjs';
import {receiveStaffCaseRecording,staffCaseRecordingReceipt} from '../server/postgres/staff-case-recordings.mjs';
import {processOneCaseVoicePurge} from '../server/postgres/case-voice.mjs';

const schema='runtime_permissions_test',role='understood_runtime_test';
async function fixture({publicationSnapshot={}}={}){
  const db=new PGlite(),pool={async connect(){return {async query(sql,args){
    if(sql==='SELECT pg_export_snapshot() AS id')return {rows:[{id:'embedded-not-native-snapshot'}]};
    return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog;CREATE ROLE ${role} LOGIN;CREATE ROLE runtime_other`);
  await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('org','Synthetic');INSERT INTO sites VALUES('site','org','Synthetic','UTC');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','org','site','Synthetic','en');
    INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','org','site','Synthetic','Synthetic source','ready');
    CREATE TABLE future_evidence(id text);CREATE SEQUENCE future_sequence;`);
  await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('pub','org','site','brief',1,$1,'published')",[JSON.stringify(publicationSnapshot)]);
  await db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','org','site','pub','worker','en')");
  const configure=(profile='application')=>configureRuntimePermissions(pool,{schema,role,profile,dedicatedDatabase:true,writersStopped:true});
  const runtime=()=>db.exec(`SET SESSION AUTHORIZATION ${role};SET search_path TO ${schema},pg_catalog`);
  const owner=async()=>{await db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');assert.equal((await db.query('SELECT current_user AS name')).rows[0].name,'postgres');};
  return {db,pool,configure,runtime,owner,async close(){await db.close();}};
}

test('dedicated runtime role keeps actual accepted-input writes but cannot migrate, truncate, forge restore journals or delegate authority',async()=>{
  const f=await fixture();try{
    const configured=await f.configure();assert.equal(configured.restricted,true);assert.equal(configured.productionReady,false);
    await f.runtime();assert.deepEqual(await verifyRuntimePermissions(f.pool,{schema,role}),configured);
    const stopped=new AbortController();stopped.abort();
    await assert.rejects(runRehearsalWorker(f.pool,{}, {schema,runtimePermissionsRequired:true,runtimeRoleProfile:'worker'},{signal:stopped.signal}),/privileges/);
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM worker_health')).rows[0].count,0);
    await f.db.query("UPDATE organizations SET name='Synthetic changed' WHERE id='org'");
    await submitAnswer(f.pool,{principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'},'assignment','accepted','Finished items go on blue, unfinished on yellow.',{schema});
    assert.equal((await f.db.query('SELECT sequence::text AS sequence FROM submission_receipts')).rows[0].sequence,'1');
    for(const sql of [
      'CREATE TABLE runtime_ddl(id text)','CREATE TEMP TABLE runtime_shadow(id text)','CREATE SCHEMA runtime_escape',
      'ALTER TABLE organizations DISABLE TRIGGER ALL','DROP TABLE organizations','TRUNCATE organizations',
      "INSERT INTO schema_migrations(version,checksum) VALUES('forged','forged')",
      'DELETE FROM restore_access_restrictions','UPDATE sqlite_import_runs SET checksum=checksum',
      'SELECT * FROM future_evidence',"SELECT nextval('future_sequence')", "SELECT setval('submission_receipts_sequence_seq',100)",
      'CREATE ROLE runtime_escalation SUPERUSER',"SET session_replication_role='replica'",
    ])await assert.rejects(f.db.exec(sql),/permission denied|must be owner|not permitted|does not exist/i,sql);
    await f.db.exec(`GRANT SELECT ON organizations TO runtime_other`);
    assert.equal((await f.db.query("SELECT has_table_privilege('runtime_other','organizations','SELECT') AS allowed")).rows[0].allowed,false);
    await assert.rejects(f.db.exec("UPDATE publications SET snapshot_json='{\"forged\":true}'"),/immutable/);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM submission_receipts')).rows[0].count,1);
    await f.owner();await f.db.exec('CREATE TABLE later_evidence(id text)');await f.runtime();
    await assert.rejects(f.db.query('SELECT * FROM later_evidence'),/permission denied/);
    assert.equal((await verifyRuntimePermissions(f.pool,{schema})).restricted,true);
  }finally{await f.close();}
});

test('permission setup is explicit, atomic and rejects privileged/member/owner/missing roles without altering business rows',async()=>{
  const f=await fixture();try{
    await assert.rejects(configureRuntimePermissions(f.pool,{schema,role}),/Confirm/);
    for(const value of ['runtime;DROP TABLE organizations','pg_shadow','Runtime',''])assert.throws(()=>runtimeRoleName(value),/Invalid/);
    await assert.rejects(configureRuntimePermissions(f.pool,{schema,role:'missing',dedicatedDatabase:true,writersStopped:true}),/unprivileged/);
    await f.db.exec(`ALTER ROLE ${role} CREATEDB`);await assert.rejects(f.configure(),/unprivileged/);
    await f.db.exec(`ALTER ROLE ${role} NOCREATEDB;CREATE ROLE runtime_group;GRANT runtime_group TO ${role}`);await assert.rejects(f.configure(),/memberships/);
    await f.db.exec(`REVOKE runtime_group FROM ${role};ALTER TABLE future_evidence OWNER TO ${role}`);await assert.rejects(f.configure(),/own database objects/);
    await f.db.exec('ALTER TABLE future_evidence OWNER TO postgres');
    await f.db.exec(`CREATE FUNCTION unsafe_definer() RETURNS void LANGUAGE sql SECURITY DEFINER AS 'SELECT NULL::void'`);
    await assert.rejects(f.configure(),/security-definer/);
    // Failed setup rolled back the earlier PUBLIC TEMP revoke.
    assert.equal((await f.db.query(`SELECT has_database_privilege($1,current_database(),'TEMPORARY') AS allowed`,[role])).rows[0].allowed,true);
    await f.db.exec('DROP FUNCTION unsafe_definer()');await f.configure();await f.runtime();
    assert.equal((await f.db.query('SELECT name FROM organizations')).rows[0].name,'Synthetic');
  }finally{await f.close();}
});

test('runtime startup inspection rejects privilege drift, future automatic grants and impersonated owner sessions',async()=>{
  const f=await fixture();try{
    await f.configure();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,role}),/connect directly/);
    for(const [grant,revoke] of [
      [`GRANT TRUNCATE ON organizations TO ${role}`,`REVOKE TRUNCATE ON organizations FROM ${role}`],
      [`GRANT MAINTAIN ON organizations TO ${role}`,`REVOKE MAINTAIN ON organizations FROM ${role}`],
      [`GRANT INSERT(version) ON schema_migrations TO ${role}`,`REVOKE INSERT(version) ON schema_migrations FROM ${role}`],
      [`GRANT SELECT ON organizations TO ${role} WITH GRANT OPTION`,`REVOKE GRANT OPTION FOR SELECT ON organizations FROM ${role}`],
      [`GRANT CREATE ON SCHEMA ${schema} TO PUBLIC`,`REVOKE CREATE ON SCHEMA ${schema} FROM PUBLIC`],
      [`GRANT TEMPORARY ON DATABASE postgres TO PUBLIC`,`REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC`],
      [`GRANT SELECT ON future_evidence TO ${role}`,`REVOKE SELECT ON future_evidence FROM ${role}`],
      [`GRANT SELECT(id) ON platform_operators TO ${role}`,`REVOKE SELECT(id) ON platform_operators FROM ${role}`],
      [`GRANT UPDATE(revoked_at) ON operator_sessions TO ${role}`,`REVOKE UPDATE(revoked_at) ON operator_sessions FROM ${role}`],
      [`GRANT INSERT ON operator_requests TO ${role}`,`REVOKE INSERT ON operator_requests FROM ${role}`],
      [`GRANT UPDATE(provider_paused) ON system_controls TO ${role}`,`REVOKE UPDATE(provider_paused) ON system_controls FROM ${role}`],
      [`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${role}`,`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE SELECT ON TABLES FROM ${role}`],
    ]){
      await f.db.exec(grant);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,role}));await f.owner();await f.db.exec(revoke);
    }
    await f.db.exec(`SET ROLE ${role}`);await assert.rejects(verifyRuntimePermissions(f.pool,{schema,role}),/connect directly/);await f.db.exec('RESET ROLE');
    await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema})).restricted,true);
  }finally{await f.close();}
});

test('source fence persists after commit, blocks real submission acceptance and worker mutation, and never changes business inventory or activates a target',async()=>{
  const f=await fixture();try{
    await f.configure();await f.db.exec("INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true)");
    await f.db.exec('CREATE ROLE understood_worker_test LOGIN');
    await configureRuntimePermissions(f.pool,{schema,role:'understood_worker_test',dedicatedDatabase:true,writersStopped:true});
    const inventory=()=>withTransaction(f.pool,client=>databaseInventory(client,schema));
    const before=await inventory();
    await assert.rejects(fenceSourceRuntime(f.pool,{schema,roles:[role],writersStopped:false}),/Stop all/);
    await assert.rejects(withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[role]})),/not fenced/);
    const result=await fenceSourceRuntime(f.pool,{schema,roles:[role,'understood_worker_test'],writersStopped:true});assert.equal(result.runtimeRoles,2);
    assert.equal(result.runtimeWriteFenceVerified,true);assert.equal(result.sourceCutoffEstablished,false);assert.equal(result.activationAllowed,false);
    assert.deepEqual(await inventory(),before);
    await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,role}),/privileges/);
    await assert.rejects(runRehearsalWorker(f.pool,{}, {schema,runtimePermissionsRequired:true}),/privileges/);
    await assert.rejects(submitAnswer(f.pool,{principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'},'assignment','after-fence','Synthetic answer',{schema}),/permission denied/);
    await assert.rejects(f.db.query("INSERT INTO worker_health(id,state,seen_at) VALUES('fenced-worker','idle',clock_timestamp())"),/permission denied/);
    await assert.rejects(f.db.query("UPDATE system_controls SET jobs_paused=false"),/permission denied/);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM submission_receipts')).rows[0].count,0);
    assert.equal((await withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[role]}))).runtimeWriteFenceVerified,true);
    await f.owner();assert.deepEqual(await inventory(),before);
    await f.db.exec(`SET SESSION AUTHORIZATION understood_worker_test`);
    await assert.rejects(f.db.query("UPDATE organizations SET name='Worker bypass'"),/permission denied/);
    await f.owner();assert.deepEqual(await inventory(),before);
    await assert.rejects(fenceSourceRuntime(f.pool,{schema,roles:[role],writersStopped:true}),/privileges/);
  }finally{await f.close();}
});

test('fence admission checks all roles and shutdown gates atomically; later privileged ACL changes invalidate live fence verification',async()=>{
  const f=await fixture();try{
    await f.configure();await f.db.exec("INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true)");
    await assert.rejects(fenceSourceRuntime(f.pool,{schema,roles:[role,'missing'],writersStopped:true}),/unprivileged/);
    await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema,role})).restricted,true);await f.owner();
    await f.db.exec("UPDATE system_controls SET provider_paused=false");await assert.rejects(fenceSourceRuntime(f.pool,{schema,roles:[role],writersStopped:true}),/Pause jobs/);
    await f.db.exec("UPDATE system_controls SET provider_paused=true");
    await fenceSourceRuntime(f.pool,{schema,roles:[role],writersStopped:true});
    await f.db.exec(`GRANT INSERT(version) ON schema_migrations TO ${role}`);
    await assert.rejects(withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[role]})),/column is not fenced/);
    await f.db.exec(`REVOKE INSERT(version) ON schema_migrations FROM ${role};GRANT USAGE ON SEQUENCE future_sequence TO ${role}`);
    await assert.rejects(withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[role]})),/sequence is not fenced/);
  }finally{await f.close();}
});

test('application SQL role cannot read operator password/session material or create, revoke or replace operator identities',async()=>{
  const f=await fixture();try {
    const configured=await f.configure();assert.equal(configured.hiddenTables,7);assert.equal(configured.profile,'application');
    await f.runtime();assert.deepEqual(await verifyRuntimePermissions(f.pool,{schema}),configured);
    for(const table of ['platform_operators','operator_sessions']) {
      for(const sql of [`SELECT * FROM ${table}`,`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table} WHERE false`,
        table==='platform_operators'?'UPDATE platform_operators SET active=active WHERE false':'UPDATE operator_sessions SET revoked_at=NULL WHERE false'])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    }
    for(const table of ['system_controls','tenant_controls','provider_policies','operator_requests'])await f.db.query(`SELECT * FROM ${table}`);
    for(const sql of ['SELECT * FROM operator_auth_attempts','DELETE FROM operator_auth_attempts'])await assert.rejects(f.db.query(sql),error=>error.code==='42501');
    await submitAnswer(f.pool,{principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'},'assignment','no-operator-credentials','Synthetic accepted answer',{schema});
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM submission_receipts')).rows[0].count,1);
  }finally{await f.close();}
});

test('application role retains required control reads but cannot suspend tenants, pause dispatch, change quotas or forge operator evidence',async()=>{
  const f=await fixture();try {
    const configured=await f.configure();assert.equal(configured.writableTables,137);assert.equal(configured.readOnlyTables,14);assert.equal(configured.hiddenTables,7);
    const columns=(await f.db.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND ordinal_position=1',[schema])).rows;
    await f.runtime();assert.deepEqual(await verifyRuntimePermissions(f.pool,{schema}),configured);
    for(const table of ['operator_requests','provider_verifications','tenant_controls','system_controls','provider_policies','operator_audit']) {
      if(table==='operator_audit')await assert.rejects(f.db.query('SELECT * FROM operator_audit'),error=>error.code==='42501');
      else await f.db.query(`SELECT * FROM ${table}`);
      const column=columns.find(row=>row.table_name===table).column_name;
      for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table} WHERE false`,`UPDATE ${table} SET ${column}=${column} WHERE false`])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    }
  }finally{await f.close();}
});

test('worker policy is explicit and independent, never granting hidden tables or mutating the application policy',()=>{
  const application=runtimeTablePolicy(),worker=runtimeTablePolicy('worker');
  assert.equal(runtimeProfile(),'application');assert.equal(runtimeProfile('worker'),'worker');
  assert.ok(worker.every(row=>row.readable || !row.writable));
  assert.equal(worker.filter(row=>!row.readable).length,15);
  assert.deepEqual(worker.find(row=>row.table==='clarification_action_receipts'),{table:'clarification_action_receipts',readable:false,writable:false,insertable:false});
  assert.deepEqual(worker.find(row=>row.table==='clarification_creations'),{table:'clarification_creations',readable:false,writable:false,insertable:false});
  assert.deepEqual(worker.find(row=>row.table==='worker_credentials'),{table:'worker_credentials',readable:false,writable:false,insertable:false});
  assert.deepEqual(worker.find(row=>row.table==='worker_setup_tokens'),{table:'worker_setup_tokens',readable:false,writable:false,insertable:false});
  assert.deepEqual(worker.find(row=>row.table==='organization_entitlements'),{table:'organization_entitlements',readable:true,writable:false,insertable:false});
  assert.deepEqual(worker.find(row=>row.table==='organization_entitlement_transitions'),{table:'organization_entitlement_transitions',readable:false,writable:false,insertable:false});
  assert.deepEqual(worker.find(row=>row.table==='organization_activation_requests'),{table:'organization_activation_requests',readable:false,writable:false,insertable:false});
  assert.deepEqual(application.filter(row=>!row.readable).map(row=>row.table),['platform_operators','operator_sessions','operator_auth_attempts','operator_audit','provider_verification_authorities','provider_verification_jobs','provider_verification_workers']);
  assert.equal(worker.filter(row=>row.writable).length<application.filter(row=>row.writable).length,true);
  for(const value of ['maintenance','',null,true,{},[]])assert.throws(()=>runtimeTablePolicy(value),/profile/);
  worker[0].writable=false;assert.deepEqual(runtimeTablePolicy(),application);
});

test('worker role rejects billing/operator reads and policy/control/admin DML using actual SQL permissions',async()=>{
  const f=await fixture();try{
    const configured=await f.configure('worker');assert.equal(configured.profile,'worker');assert.equal(configured.hiddenTables,15);
    const columns=(await f.db.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND ordinal_position=1',[schema])).rows;
    await f.runtime();assert.deepEqual(await verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),configured);
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema}),/privileges/);
    for(const policy of runtimeTablePolicy('worker')){
      if(!policy.readable)await assert.rejects(f.db.query(`SELECT * FROM "${policy.table}"`),error=>error.code==='42501',policy.table);
      if(policy.writable)continue;
      const column=columns.find(row=>row.table_name===policy.table).column_name;
      for(const sql of [`DELETE FROM "${policy.table}" WHERE false`,`INSERT INTO "${policy.table}" DEFAULT VALUES`,
        `UPDATE "${policy.table}" SET "${column}"="${column}" WHERE false`])await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    }
    for(const table of ['provider_policies','system_controls','tenant_controls','organization_settings'])await f.db.query(`SELECT * FROM ${table}`);
    for(const sql of ['CREATE TABLE worker_escape(id text)','TRUNCATE jobs','SELECT * FROM future_evidence',"SELECT nextval('future_sequence')"])
      await assert.rejects(f.db.exec(sql),/permission denied/);
    await f.owner();await f.db.exec(`GRANT SELECT(id) ON invoices TO ${role}`);await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
    await f.owner();await f.db.exec(`REVOKE SELECT(id) ON invoices FROM ${role};GRANT UPDATE(revision) ON provider_policies TO ${role}`);await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
  }finally{await f.close();}
});

test('worker cannot edit customer template or glossary libraries but prepares a real template-derived draft against the frozen glossary',async()=>{
  const f=await fixture(),options={schema,integrationMode:'synthetic'},owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
  const library=['templates','template_versions','glossary_terms','glossary_versions'];
  const inventory=async()=>Promise.all(library.map(async table=>(await f.db.query(`SELECT * FROM ${table}`)).rows));
  try{
    await f.db.exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Synthetic owner','owner')");
    await f.db.query("UPDATE briefings SET source=$1 WHERE id='brief'",[CANONICAL_SOURCE]);
    await f.configure();await f.runtime();
    const template=await changeTemplate(f.pool,owner,'create',null,{requestId:randomUUID(),confirmed:true,title:'Synthetic worker library',description:'Synthetic handover',source:CANONICAL_SOURCE,question:'',facts:[],askedFacts:[]},options);
    const term=await changeGlossary(f.pool,owner,'create',null,{requestId:randomUUID(),confirmed:true,term:'blue shelf',sourceLanguage:'en',targetLanguage:'ar',override:''},options);
    const draft=await changeTemplate(f.pool,owner,'use',template.id,{requestId:randomUUID(),confirmed:true,revision:1,title:'Synthetic library draft'},options);
    const before=await inventory();assert.ok(before.every(rows=>rows.length===1));
    await f.owner();const configured=await f.configure('worker');
    assert.equal(configured.writableTables,108);assert.equal(configured.readOnlyTables,35);
    await f.runtime();assert.deepEqual(await verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),configured);
    const glossary=await withTransaction(f.pool,client=>readGlossarySnapshot(client,'org','site'));
    assert.equal(glossary.terms.length,1);
    for(const table of library){
      const column=table==='templates'||table==='glossary_terms'?'id':table==='template_versions'?'template_id':'term_id';
      for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`UPDATE ${table} SET ${column}=${column}`,`DELETE FROM ${table}`])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    }
    await assert.rejects(changeTemplate(f.pool,owner,'archive',template.id,{requestId:randomUUID(),confirmed:true,revision:1},options),error=>error.code==='42501');
    await assert.rejects(changeGlossary(f.pool,owner,'edit',term.id,{requestId:randomUUID(),confirmed:true,revision:1,override:''},options),error=>error.code==='42501');
    assert.equal((await f.db.query("SELECT count(*)::int n FROM jobs WHERE kind='prepare' AND status='queued'")).rows[0].n,2);
    // The glossary edit requeues the original fixture draft before the template use.
    assert.equal(await processOnePreparation(f.pool,options),true);
    assert.equal(await processOnePreparation(f.pool,options),true);
    assert.equal(await processOnePreparation(f.pool,options),false);
    const prepared=(await f.db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[draft.id])).rows[0];
    assert.equal(prepared.state,'ready');assert.deepEqual(prepared.prepared_json.provenance.glossary,{revision:glossary.revision,hash:glossary.hash,terms:glossary.terms.map(({id,revision})=>({id,revision}))});
    assert.deepEqual(await inventory(),before);
    for(const table of library){
      await f.owner();await f.db.exec(`GRANT INSERT,UPDATE,DELETE ON ${table} TO ${role}`);await f.runtime();
      await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
      await f.owner();await f.configure('worker');await f.runtime();
      assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
    }
    assert.deepEqual(await inventory(),before);
  }finally{await f.close();}
});

test('worker scheduler processes a populated assessment and recovery expiry under its actual worker profile',async()=>{
  const f=await fixture({publicationSnapshot:{question:'Where will finished and unfinished items go?',
    rubric:{askedFacts:['finished -> blue shelf','unfinished -> yellow shelf']}}});
  try{
    await submitAnswer(f.pool,{principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'},'assignment','worker-profile-answer','Finished items go on the blue shelf and unfinished items on the yellow shelf.',{schema});
    await f.db.exec("INSERT INTO staff_recovery_mail(id,purpose,email_hash,payload,expires_at,state) VALUES('expired-recovery','reset',repeat('a',64),'synthetic-encrypted-placeholder',clock_timestamp()-interval '1 second','queued')");
    await f.configure('worker');await f.runtime();const errors=[];
    const storage=Object.fromEntries(['save','read','remove','exists'].map(method=>[method,async()=>assert.fail(`No ${method} storage work is queued in this fixture`)]));
    const tasks=rehearsalTasks(f.pool,storage,{schema});
    const cycle=await runWorkerCycle(tasks,{onError:stage=>errors.push(stage)});
    assert.deepEqual(Object.keys(cycle),Object.keys(tasks));
    assert.deepEqual(errors,[]);assert.equal(cycle.assessment,true);
    assert.deepEqual((await f.db.query('SELECT outcome,assessment_status FROM attempts')).rows,[{outcome:'matched',assessment_status:'complete'}]);
    assert.deepEqual((await f.db.query('SELECT state,payload FROM staff_recovery_mail')).rows,[{state:'expired',payload:null}]);
    assert.equal((await f.db.query('SELECT status FROM assessment_jobs')).rows[0].status,'complete');
    const controller=new AbortController();controller.abort();
    await runRehearsalWorker(f.pool,{}, {schema,runtimePermissionsRequired:true,runtimeRoleProfile:'worker'},{signal:controller.signal,onError:stage=>errors.push(stage)});
    assert.deepEqual(errors,[]);assert.equal((await f.db.query('SELECT state FROM worker_health')).rows[0].state,'stopped');
    await assert.rejects(runRehearsalWorker(f.pool,{}, {schema,runtimePermissionsRequired:true,runtimeRoleProfile:'application'},{signal:controller.signal}),/privileges/);
  }finally{await f.close();}
});

test('worker case workflow policy denies creation, deletion, evidence columns and review sequence authority with unchanged business rows',async()=>{
  const f=await fixture();try{
    const before=await withTransaction(f.pool,client=>databaseInventory(client,schema));
    await f.configure('worker');await f.runtime();
    for(const [table,allowed] of Object.entries(caseWorkflowUpdates)){
      await inspectRuntimeUpdateColumns(await f.pool.connect(),{schema,role,table,updates:allowed});
      const columns=(await f.db.query('SELECT column_name,is_identity FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table])).rows;
      for(const {column_name:column,is_identity:identity} of columns.filter(row=>!allowed.includes(row.column_name)))
        await assert.rejects(f.db.query(`UPDATE ${table} SET "${column}"=${identity==='YES'?'DEFAULT':`"${column}"`} WHERE false`),error=>error.code==='42501',`${table}.${column}`);
      for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table} WHERE false`,`TRUNCATE ${table}`])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    }
    for(const sql of ["SELECT nextval('case_reviews_sequence_seq')","SELECT setval('case_reviews_sequence_seq',99)",'SELECT * FROM case_reviews_sequence_seq'])
      await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    await f.owner();assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
  }finally{await f.close();}
});

test('case workflow startup rejects broad, delegated, PUBLIC, future-column, sequence and guard drift; reconfiguration removes old grants',async()=>{
  const f=await fixture();try{
    await f.configure('worker');
    const before=await withTransaction(f.pool,client=>databaseInventory(client,schema));
    for(const [grant,revoke] of [
      [`GRANT INSERT,DELETE ON case_reviews TO ${role}`,`REVOKE INSERT,DELETE ON case_reviews FROM ${role}`],
      [`GRANT UPDATE ON case_repeats TO ${role}`,`REVOKE UPDATE ON case_repeats FROM ${role};GRANT UPDATE(status) ON case_repeats TO ${role}`],
      [`GRANT UPDATE(due_at) ON case_reviews TO ${role}`,`REVOKE UPDATE(due_at) ON case_reviews FROM ${role}`],
      [`GRANT UPDATE(submission_id) ON case_repeats TO ${role}`,`REVOKE UPDATE(submission_id) ON case_repeats FROM ${role}`],
      [`GRANT UPDATE(reason) ON case_reviews TO ${role} WITH GRANT OPTION`,`REVOKE GRANT OPTION FOR UPDATE(reason) ON case_reviews FROM ${role}`],
      ['GRANT UPDATE(status) ON case_repeats TO PUBLIC','REVOKE UPDATE(status) ON case_repeats FROM PUBLIC'],
      [`REVOKE UPDATE(reason) ON case_reviews FROM ${role}`,`GRANT UPDATE(reason) ON case_reviews TO ${role}`],
      [`GRANT USAGE,SELECT ON case_reviews_sequence_seq TO ${role}`,`REVOKE USAGE,SELECT ON case_reviews_sequence_seq FROM ${role}`],
      [`GRANT INSERT,DELETE ON case_voice TO ${role}`,`REVOKE INSERT,DELETE ON case_voice FROM ${role}`],
      [`GRANT UPDATE(actor_id,actor_role,received_at,case_id) ON case_voice TO ${role}`,`REVOKE UPDATE(actor_id,actor_role,received_at,case_id) ON case_voice FROM ${role}`],
    ]){
      await f.db.exec(grant);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
      await f.owner();await f.db.exec(revoke);await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);await f.owner();
    }
    await f.db.exec(`ALTER TABLE case_reviews ADD COLUMN future_case_note text;GRANT UPDATE(future_case_note) ON case_reviews TO ${role}`);
    await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);await f.owner();
    await f.db.exec(`REVOKE UPDATE(future_case_note) ON case_reviews FROM ${role};ALTER TABLE case_reviews DROP COLUMN future_case_note`);
    for(const [table,trigger,name] of [['case_reviews','case_review_guard','guard_case_review'],['case_repeats','case_repeat_guard','guard_case_repeat'],['case_voice','case_voice_guard','guard_case_voice']]){
      const definition=(await f.db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition',[`${name}()`])).rows[0].definition;
      const triggerDefinition=(await f.db.query('SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2',[table,trigger])).rows[0].definition;
      for(const [damage,restore] of [
        [`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`,`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`],
        [`DROP TRIGGER ${trigger} ON ${table}`,triggerDefinition],
        [`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,definition],
        [`ALTER FUNCTION ${name}() SECURITY DEFINER`,definition],
        [`DROP TRIGGER ${trigger} ON ${table};CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW WHEN (false) EXECUTE FUNCTION ${name}()`,`DROP TRIGGER ${trigger} ON ${table};${triggerDefinition}`],
      ]){
        await f.db.exec(damage);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/case workflow guards/);
        await f.owner();await assert.rejects(f.configure('worker'),/case workflow guards/);await f.db.exec(restore);
      }
    }
    await f.db.exec(`GRANT INSERT,UPDATE,DELETE ON case_reviews,case_repeats,case_voice TO ${role};GRANT USAGE,SELECT ON case_reviews_sequence_seq TO ${role}`);
    await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);await f.owner();
    await f.configure('worker');await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
    await assert.rejects(f.db.query('INSERT INTO case_reviews DEFAULT VALUES'),error=>error.code==='42501');
    await f.owner();assert.deepEqual(await withTransaction(f.pool,client=>databaseInventory(client,schema)),before);
  }finally{await f.close();}
});

test('separate API and cleanup worker preserve supervisor receipts through repeated assessment and authorized deletion redaction',async()=>{
  const f=await fixture({publicationSnapshot:{question:'Where?',rubric:{askedFacts:['Blue shelf']}}}),workerRole='case_cleanup_worker_test',options={schema};
  const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'},worker={principal_type:'worker',principal_id:'worker',org_id:'org',site_id:'site'};
  const asWorker=()=>f.db.exec(`SET SESSION AUTHORIZATION ${workerRole}`),adapter={assess:async()=>({outcome:'clarification',reasons:['missing_asked_fact'],evidence:[]})};
  try{
    await f.db.exec(`INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Synthetic owner','owner');CREATE ROLE ${workerRole} LOGIN`);
    await f.configure();await configureRuntimePermissions(f.pool,{schema,role:workerRole,profile:'worker',dedicatedDatabase:true,writersStopped:true});
    await f.runtime();const original=await submitAnswer(f.pool,worker,'assignment',randomUUID(),'Synthetic original incomplete answer',options);
    await f.owner();await asWorker();assert.equal(await processOneAssessment(f.pool,adapter,options),true);
    const caseId=(await f.db.query('SELECT id FROM clarifications')).rows[0].id;
    await f.owner();await f.runtime();
    const review=await saveCaseReview(f.pool,owner,caseId,{requestId:randomUUID(),kind:'disagree',reason:'Synthetic private disagreement for cleanup'},options);
    const deadline=await saveCaseReview(f.pool,owner,caseId,{requestId:randomUUID(),kind:'deadline',dueAt:new Date(Date.now()+86400000).toISOString(),expectedDueAt:(await getClarification(f.pool,owner,caseId,options)).case_due_at},options);
    const first=await requestCaseRepeat(f.pool,owner,caseId,{requestId:randomUUID(),dueAt:new Date(Date.now()+86400000).toISOString()},options);
    await submitAnswer(f.pool,worker,'assignment',randomUUID(),'Synthetic deliberate repeat answer',options);
    assert.equal((await caseRepeatReceipt(f.pool,owner,caseId,first.id,options)).status,'submitted');
    await f.owner();await asWorker();assert.equal(await processOneAssessment(f.pool,adapter,options),true);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM clarifications')).rows[0].n,1);
    await assert.rejects(saveCaseReview(f.pool,owner,caseId,{requestId:randomUUID(),kind:'disagree',reason:'Forged worker supervisor request'},options),error=>error.code==='42501');
    await assert.rejects(requestCaseRepeat(f.pool,owner,caseId,{requestId:randomUUID(),dueAt:new Date(Date.now()+86400000).toISOString()},options),error=>error.code==='42501');
    await assert.rejects(f.db.query("UPDATE case_reviews SET reason='Unauthorized replacement' WHERE id=$1",[review.id]),/immutable/);
    await f.owner();await f.runtime();const audioRepeat=await requestCaseRepeat(f.pool,owner,caseId,{requestId:randomUUID(),dueAt:new Date(Date.now()+86400000).toISOString()},options);
    const objects=new Map(),bytes=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(0.2)}));
    const storage={async save(row,data){objects.set(row.id,Buffer.from(data));},async read(row){return objects.get(row.id);},async remove(row){objects.delete(row.id);},async exists(row){return objects.has(row.id);}};
    const staffAudio=await receiveStaffCaseRecording(f.pool,owner,caseId,randomUUID(),'ur',bytes,storage,options);
    assert.equal(staffAudio.status,'received');assert.equal(staffAudio.actorRole,'owner');
    const recording=await receiveRecording(f.pool,worker,'assignment',randomUUID(),bytes,storage,options);
    assert.equal((await caseRepeatReceipt(f.pool,owner,caseId,audioRepeat.id,options)).status,'submitted');assert.equal(objects.size,2);
    await f.owner();await asWorker();assert.equal(await processOneRecording(f.pool,{...adapter,transcribe:async()=>({text:'Synthetic recorded repeat answer'})},storage,options),true);
    assert.equal((await f.db.query('SELECT status FROM recordings WHERE id=$1',[recording.id])).rows[0].status,'transcribed');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM clarifications')).rows[0].n,1);
    await f.owner();await f.runtime();const second=await requestCaseRepeat(f.pool,owner,caseId,{requestId:randomUUID(),dueAt:new Date(Date.now()+86400000).toISOString()},options);
    const receipts=(await f.db.query('SELECT * FROM submission_receipts ORDER BY sequence')).rows,reviews=(await f.db.query('SELECT * FROM case_reviews ORDER BY sequence')).rows;
    const attempts=(await f.db.query('SELECT id,assignment_id,submission_id,outcome FROM attempts ORDER BY id')).rows;
    assert.ok(attempts.some(row=>row.id===original.id));
    await requestWorkerDeletion(f.pool,owner,'worker',{requestId:randomUUID(),expectedCode:'Synthetic',reason:'customer_policy',confirmed:true},options);
    await f.owner();await asWorker();assert.equal(await processOneDeletionRedaction(f.pool,options),false);
    assert.equal(await processOneAudioPurge(f.pool,storage,options),true);assert.equal(objects.size,1);
    assert.equal(await processOneCaseVoicePurge(f.pool,storage,options),true);assert.equal(objects.size,0);
    assert.equal(await processOneDeletionRedaction(f.pool,options),true);assert.equal(await processOneDeletionRedaction(f.pool,options),false);
    assert.deepEqual((await f.db.query('SELECT id,assignment_id,submission_id,outcome FROM attempts ORDER BY id')).rows,attempts);
    assert.deepEqual((await f.db.query('SELECT * FROM submission_receipts ORDER BY sequence')).rows,receipts);
    assert.deepEqual((await f.db.query('SELECT * FROM case_reviews ORDER BY sequence')).rows,reviews.map(row=>row.kind==='disagree'?{...row,reason:'[Deleted]'}:row));
    assert.equal((await f.db.query('SELECT status FROM case_repeats WHERE id=$1',[second.id])).rows[0].status,'cancelled');
    await f.owner();await f.runtime();assert.equal((await caseReviewReceipt(f.pool,owner,caseId,review.id,options)).requestHash,review.requestHash);
    assert.deepEqual(await staffCaseRecordingReceipt(f.pool,owner,caseId,staffAudio.requestId,options),staffAudio);
    assert.equal((await caseReviewReceipt(f.pool,owner,caseId,deadline.id,options)).dueAt,deadline.dueAt);
  }finally{await f.close();}
});

test('cleanup worker expires retained private review text without changing deadline receipts or original assessment metadata',async()=>{
  const f=await fixture(),options={schema},owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
  try{
    await f.db.exec(`INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Synthetic owner','owner');
      INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,assessment_status)
        VALUES('old-attempt','org','site','assignment','old-answer','Synthetic preserved answer','clarification','[]','complete');
      ALTER TABLE clarifications DISABLE TRIGGER case_resolution_clock;
      INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,notes,status,created_at,resolved_at)
        VALUES('old-case','org','site','assignment','old-attempt','Synthetic reason','Synthetic note','resolved',clock_timestamp()-interval '50 days',clock_timestamp()-interval '40 days');
      ALTER TABLE clarifications ENABLE TRIGGER case_resolution_clock;
      INSERT INTO case_reviews(id,org_id,site_id,case_id,assignment_id,actor_id,actor_role,kind,request_hash,reason,attempt_id,created_at)
        VALUES('old-review','org','site','old-case','assignment','owner','owner','disagree',repeat('b',64),'Synthetic private old reason','old-attempt',clock_timestamp()-interval '40 days');`);
    await saveCaseRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true},options);
    const before=(await f.db.query('SELECT * FROM attempts')).rows,review=(await f.db.query('SELECT * FROM case_reviews')).rows[0];
    await f.configure('worker');await f.runtime();
    await assert.rejects(f.db.query("UPDATE case_reviews SET reason='[Expired]'"),/immutable/);
    assert.equal(await processOneCaseContentPurge(f.pool,options),true);assert.equal(await processOneCaseContentPurge(f.pool,options),false);
    assert.deepEqual((await f.db.query('SELECT * FROM attempts')).rows,before);
    assert.deepEqual((await f.db.query('SELECT * FROM case_reviews')).rows,[{...review,reason:'[Expired]'}]);
    await assert.rejects(f.db.query("UPDATE case_reviews SET reason='Restored private reason'"),/immutable/);
  }finally{await f.close();}
});

const identityLocks={staff:'id',staff_accounts:'id',staff_credentials:'staff_id',staff_access_revisions:'staff_id'};
const identityInventory=async db=>Object.fromEntries(await Promise.all([...Object.keys(identityLocks),'staff_account_memberships'].map(async table=>[table,(await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows])));
async function seedStaffIdentity(f){
  await f.db.exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Synthetic owner','owner');INSERT INTO staff_access_revisions VALUES('owner','org','site',2)");
  await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'org',siteId:'site',email:'owner@example.test',password:'Synthetic-original-password-123'},{schema});
}

test('identity-lock migration upgrades a populated preceding schema without rewriting identities and is repeatable',async()=>{
  const f=await fixture();try{
    for(const table of Object.keys(identityLocks))await f.db.exec(`DROP TRIGGER identity_runtime_update ON ${table}`);
    await f.db.exec("DROP FUNCTION restrict_identity_runtime_update();DELETE FROM schema_migrations WHERE version='092_worker_identity_locks.sql'");
    await seedStaffIdentity(f);const before=await identityInventory(f.db);
    await assert.rejects(f.configure('worker'),/identity runtime guards/);
    assert.deepEqual(await runMigrations(f.pool,{schema}),['092_worker_identity_locks.sql']);
    assert.deepEqual(await identityInventory(f.db),before);assert.deepEqual(await runMigrations(f.pool,{schema}),[]);
    await f.configure('worker');await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
    assert.deepEqual(await identityInventory(f.db),before);
  }finally{await f.close();}
});

test('worker identity locks preserve all staff, credentials, revisions and memberships while denying direct business writes',async()=>{
  const f=await fixture();try{
    await seedStaffIdentity(f);const before=await identityInventory(f.db);await f.configure('worker');await f.runtime();
    assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).readOnlyTables,35);
    for(const [table,key] of Object.entries(identityLocks)){
      for(const lock of ['SHARE','UPDATE'])await withTransaction(f.pool,client=>client.query(`SELECT ${key} FROM ${table} FOR ${lock}`));
      await f.db.query(`UPDATE ${table} SET ${key}=${key}`);
      for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table}`,`UPDATE ${table} SET ${key}='forged'`])
        await assert.rejects(f.db.query(sql),/permission denied|immutable/i,sql);
    }
    for(const sql of ["UPDATE staff SET role='auditor'","UPDATE staff SET active=false","UPDATE staff SET name='Forged'",
      "UPDATE staff_accounts SET active=false","UPDATE staff_accounts SET revision=revision+1","UPDATE staff_credentials SET email='forged@example.test'",
      "UPDATE staff_credentials SET password_hash='forged'","UPDATE staff_credentials SET password_salt='forged'",
      'UPDATE staff_credentials SET changed_at=clock_timestamp()','UPDATE staff_access_revisions SET revision=revision+1',
      'INSERT INTO staff_account_memberships DEFAULT VALUES','DELETE FROM staff_account_memberships','UPDATE staff_account_memberships SET staff_id=staff_id'])
      await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    assert.deepEqual(await identityInventory(f.db),before);
  }finally{await f.close();}
});

test('worker identity permission inspection rejects new-column, broad, delegated, PUBLIC, membership and immutable-guard drift',async()=>{
  const f=await fixture();try{
    await seedStaffIdentity(f);await f.db.exec('CREATE SEQUENCE identity_lock_sequence OWNED BY staff.id');await f.configure('worker');
    const definition=(await f.db.query("SELECT pg_get_functiondef('restrict_identity_runtime_update()'::regprocedure) definition")).rows[0].definition;
    const trigger=(await f.db.query("SELECT pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='staff_credentials'::regclass AND tgname='identity_runtime_update'")).rows[0].definition;
    const before=await identityInventory(f.db);
    const drift=[
      [`GRANT UPDATE ON staff_credentials TO ${role}`,`REVOKE UPDATE ON staff_credentials FROM ${role};GRANT UPDATE(staff_id) ON staff_credentials TO ${role}`],
      [`GRANT INSERT ON staff_accounts TO ${role}`,`REVOKE INSERT ON staff_accounts FROM ${role}`],
      [`GRANT UPDATE(role) ON staff TO ${role}`,`REVOKE UPDATE(role) ON staff FROM ${role}`],
      [`GRANT UPDATE(revision) ON staff_access_revisions TO ${role}`,`REVOKE UPDATE(revision) ON staff_access_revisions FROM ${role}`],
      [`GRANT UPDATE(id) ON staff_accounts TO ${role} WITH GRANT OPTION`,`REVOKE GRANT OPTION FOR UPDATE(id) ON staff_accounts FROM ${role}`],
      ['GRANT UPDATE(staff_id) ON staff_credentials TO PUBLIC','REVOKE UPDATE(staff_id) ON staff_credentials FROM PUBLIC'],
      [`GRANT INSERT ON staff_account_memberships TO ${role}`,`REVOKE INSERT ON staff_account_memberships FROM ${role}`],
      [`REVOKE UPDATE(id) ON staff FROM ${role}`,`GRANT UPDATE(id) ON staff TO ${role}`],
      [`GRANT USAGE,SELECT ON identity_lock_sequence TO ${role}`,`REVOKE USAGE,SELECT ON identity_lock_sequence FROM ${role}`],
    ];
    for(const [grant,revoke] of drift){
      await f.db.exec(grant);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
      await f.owner();await f.db.exec(revoke);await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);await f.owner();
    }
    await f.db.exec(`ALTER TABLE staff_credentials ADD COLUMN future_identity text;GRANT UPDATE(future_identity) ON staff_credentials TO ${role}`);await f.runtime();
    // Guard rejects writes even before the admission check notices an unexpected column grant.
    await assert.rejects(f.db.query("UPDATE staff_credentials SET future_identity='forged'"),error=>error.code==='42501');
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);await f.owner();
    await f.db.exec(`REVOKE UPDATE(future_identity) ON staff_credentials FROM ${role};ALTER TABLE staff_credentials DROP COLUMN future_identity`);
    for(const [damage,restore] of [
      ['ALTER TABLE staff DISABLE TRIGGER identity_runtime_update','ALTER TABLE staff ENABLE TRIGGER identity_runtime_update'],
      ['DROP TRIGGER identity_runtime_update ON staff_credentials',trigger],
      ['CREATE OR REPLACE FUNCTION restrict_identity_runtime_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',definition],
    ]){
      await f.db.exec(damage);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/identity runtime guards/);
      await f.owner();await assert.rejects(f.configure('worker'),/identity runtime guards/);await f.db.exec(restore);
    }
    await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
    await assert.rejects(f.db.query("SELECT nextval('identity_lock_sequence')"),error=>error.code==='42501');
    assert.deepEqual(await identityInventory(f.db),before);
  }finally{await f.close();}
});

test('separate API and identity-lock worker complete synthetic recovery and invitation delivery without worker identity rewrites',async()=>{
  const f=await fixture(),worker='identity_worker_test',options={schema};
  const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner',access_mode:'credential'};
  const mail=resolveMailConfig({mode:'resend',apiKey:'re_synthetic_only',from:'fixture@example.test',key:'07'.repeat(32),publicOrigin:'http://127.0.0.1:3140',allowLocal:true});
  const asWorker=()=>f.db.exec(`SET SESSION AUTHORIZATION ${worker}`);
  try{
    await seedStaffIdentity(f);await f.db.exec(`CREATE ROLE ${worker} LOGIN`);await f.configure();
    await configureRuntimePermissions(f.pool,{schema,role:worker,profile:'worker',dedicatedDatabase:true,writersStopped:true});await f.runtime();
    await requestRecovery(f.pool,{email:'owner@example.test'},'synthetic-ip',mail,options);
    const invitation=await issueInvitation(f.pool,owner,{requestId:randomUUID(),name:'Synthetic recipient',email:'recipient@example.test',role:'supervisor',confirmed:true},mail,options);
    const before=await identityInventory(f.db);await f.owner();await asWorker();let recoveryToken,invitationToken;const deliveries=[];
    const send=async(_config,_id,message)=>{deliveries.push(message.subject);recoveryToken=message.text.match(/#reset-password\/([A-Za-z0-9_-]{43})/)?.[1]??recoveryToken;invitationToken=message.text.match(/#accept-invitation\/([A-Za-z0-9_-]{43})/)?.[1]??invitationToken;return {providerId:'synthetic-local'};};
    assert.equal(await processOneRecovery(f.pool,mail,{...options,send}),true);
    assert.equal(await processOneInvitation(f.pool,mail,{...options,send}),true);
    assert.ok(recoveryToken);assert.ok(invitationToken);assert.deepEqual(await identityInventory(f.db),before);
    assert.equal((await f.db.query('SELECT state FROM staff_invitations WHERE id=$1',[invitation.id])).rows[0].state,'pending');
    await f.owner();await f.runtime();const replacement='Synthetic-replacement-password-123';
    assert.equal((await resetPassword(f.pool,{token:recoveryToken,password:replacement,confirmation:replacement},'synthetic-reset-ip',mail,options)).completed,true);
    assert.equal((await authenticateStaff(f.pool,'owner@example.test',replacement,'synthetic-login-ip',options)).principal.id,'owner');
    assert.equal((await acceptInvitation(f.pool,null,'signup',{requestId:randomUUID(),token:invitationToken,password:replacement,confirmation:replacement},'synthetic-signup-ip',mail,options)).signInRequired,true);
    assert.equal((await authenticateStaff(f.pool,'recipient@example.test',replacement,'synthetic-recipient-ip',options)).principal.role,'supervisor');
    const after=await identityInventory(f.db);assert.equal(after.staff.length,2);assert.equal(after.staff_account_memberships.length,2);
    await f.owner();await asWorker();assert.equal(await processOneRecovery(f.pool,mail,{...options,send}),true);
    assert.deepEqual(deliveries,['Reset your Understood password','Your Understood invitation','Your Understood password was changed']);
    assert.deepEqual(await identityInventory(f.db),after);
    assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
  }finally{await f.close();}
});

test('worker organization/site row-lock grants cannot create, rename, delete or change even unreferenced identities',async()=>{
  const f=await fixture();
  const inventory=async()=>({organizations:(await f.db.query('SELECT * FROM organizations ORDER BY id')).rows,sites:(await f.db.query('SELECT * FROM sites ORDER BY id')).rows});
  try{
    await f.db.exec("INSERT INTO organizations VALUES('empty-org','Unused synthetic');INSERT INTO sites VALUES('empty-site','empty-org','Unused site','UTC')");
    const before=await inventory();await f.configure('worker');await f.runtime();
    const configured=await verifyRuntimePermissions(f.pool,{schema,profile:'worker'});assert.equal(configured.writableTables,108);
    await domainTransaction(f.pool,schema,async client=>{await requireTenantActive(client,'org');await requireWorkerSiteAccess(client,'org','site');});
    for(const table of ['organizations','sites']){
      await withTransaction(f.pool,client=>client.query(`SELECT id FROM ${table} ORDER BY id FOR UPDATE`));
      await f.db.query(`UPDATE ${table} SET id=id`);
      for(const sql of [`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table}`,`UPDATE ${table} SET name='Forged name'`,
        `UPDATE ${table} SET id='forged' WHERE id='${table==='organizations'?'empty-org':'empty-site'}'`])
        await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    }
    for(const sql of ["UPDATE sites SET org_id='org' WHERE id='empty-site'","UPDATE sites SET timezone='Asia/Beirut'"])
      await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    for(const selection of [{table:'organizations',updates:['missing_column']},{table:'missing_table',updates:['id']}])
      await assert.rejects(withTransaction(f.pool,client=>inspectRuntimeUpdateColumns(client,{schema,role,...selection})),/privileges/);
    assert.deepEqual(await inventory(),before);
    await f.owner();await f.db.exec("INSERT INTO tenant_controls(org_id,revision,state,reason) VALUES('org',1,'suspended','pilot_review')");await f.runtime();
    await assert.rejects(domainTransaction(f.pool,schema,client=>requireTenantActive(client,'org')),/Workspace access paused/);
    await f.owner();await f.db.exec("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason) VALUES('site','org',1,'paused','pilot_review')");await f.runtime();
    await assert.rejects(domainTransaction(f.pool,schema,client=>requireWorkerSiteAccess(client,'org','site')),/Worker access paused/);
    assert.deepEqual(await inventory(),before);
  }finally{await f.close();}
});

test('worker lock-column admission rejects broad, extra-column, delegated and PUBLIC grants and never receives their sequences',async()=>{
  const f=await fixture();try{
    await f.db.exec('CREATE SEQUENCE lock_only_sequence OWNED BY organizations.id');
    await f.configure('worker');await f.runtime();
    await assert.rejects(f.db.query("SELECT nextval('lock_only_sequence')"),error=>error.code==='42501');
    const drift=[
      [`GRANT UPDATE ON organizations TO ${role}`,`REVOKE UPDATE ON organizations FROM ${role};GRANT UPDATE(id) ON organizations TO ${role}`],
      [`GRANT INSERT ON sites TO ${role}`,`REVOKE INSERT ON sites FROM ${role}`],
      [`GRANT DELETE ON organizations TO ${role}`,`REVOKE DELETE ON organizations FROM ${role}`],
      [`GRANT UPDATE(name) ON organizations TO ${role}`,`REVOKE UPDATE(name) ON organizations FROM ${role}`],
      [`GRANT UPDATE(timezone) ON sites TO ${role}`,`REVOKE UPDATE(timezone) ON sites FROM ${role}`],
      [`GRANT UPDATE(id) ON sites TO ${role} WITH GRANT OPTION`,`REVOKE GRANT OPTION FOR UPDATE(id) ON sites FROM ${role}`],
      ['GRANT UPDATE(id) ON organizations TO PUBLIC','REVOKE UPDATE(id) ON organizations FROM PUBLIC'],
      ['GRANT SELECT(id) ON sites TO PUBLIC','REVOKE SELECT(id) ON sites FROM PUBLIC'],
      [`REVOKE UPDATE(id) ON organizations FROM ${role}`,`GRANT UPDATE(id) ON organizations TO ${role}`],
      [`GRANT USAGE,SELECT ON lock_only_sequence TO ${role}`,`REVOKE USAGE,SELECT ON lock_only_sequence FROM ${role}`],
    ];
    for(const [grant,revoke] of drift){
      await f.owner();await f.db.exec(grant);await f.runtime();
      await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
      await f.owner();await f.db.exec(revoke);await f.runtime();
      assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
    }
    await f.owner();await f.db.exec(`ALTER TABLE sites ADD COLUMN future_setting text;GRANT UPDATE(future_setting) ON sites TO ${role}`);await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/privileges/);
    await f.owner();await f.db.exec(`REVOKE UPDATE(future_setting) ON sites FROM ${role}`);await f.runtime();
    assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);
  }finally{await f.close();}
});

test('worker admission and permission setup require the original immutable column-lock function and enabled triggers',async()=>{
  const f=await fixture();try{
    await f.configure('worker');
    const definition=(await f.db.query("SELECT pg_get_functiondef('restrict_column_runtime_update()'::regprocedure) definition")).rows[0].definition;
    const trigger=(await f.db.query("SELECT pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='sites'::regclass AND tgname='column_runtime_update'")).rows[0].definition;
    for(const [damage,restore] of [
      ['ALTER TABLE organizations DISABLE TRIGGER column_runtime_update','ALTER TABLE organizations ENABLE TRIGGER column_runtime_update'],
      ['DROP TRIGGER column_runtime_update ON sites',trigger],
      ['CREATE OR REPLACE FUNCTION restrict_column_runtime_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',definition],
    ]){
      await f.db.exec(damage);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'worker'}),/runtime guards/);
      await f.owner();await assert.rejects(f.configure('worker'),/runtime guards/);await f.db.exec(restore);await f.runtime();
      assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).restricted,true);await f.owner();
    }
  }finally{await f.close();}
});

test('distinct application and lock-restricted worker roles complete actual scheduled publication and populated retention without organization/site changes',async()=>{
  const f=await fixture(),worker='lock_worker_test',options={schema,integrationMode:'synthetic'},owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
  const asWorker=()=>f.db.exec(`SET SESSION AUTHORIZATION ${worker}`);
  const inventory=async()=>({organizations:(await f.db.query('SELECT * FROM organizations')).rows,sites:(await f.db.query('SELECT * FROM sites')).rows});
  try{
    await f.db.exec(`CREATE ROLE ${worker} LOGIN;INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','org','site','Synthetic owner','owner')`);
    await f.configure();await configureRuntimePermissions(f.pool,{schema,role:worker,profile:'worker',dedicatedDatabase:true,writersStopped:true});
    await f.runtime();const draft=await createDraft(f.pool,owner,{requestId:randomUUID(),title:'Scheduled worker lock test',source:CANONICAL_SOURCE},options);
    await requestPreparation(f.pool,owner,draft.id,{requestId:randomUUID(),revision:1,jobId:null,generation:0},options);
    await f.owner();await asWorker();assert.equal(await processOnePreparation(f.pool,options),true);
    assert.equal((await f.db.query('SELECT state FROM briefings WHERE id=$1',[draft.id])).rows[0].state,'ready');
    await f.owner();await f.runtime();const publishAt=new Date(Date.now()+1200).toISOString();
    const schedule=await createSchedule(f.pool,owner,draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker'],publishAt,dueAt:null},options);
    await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true},options);
    await f.owner();
    await f.db.query("INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,assessment_status,received_at) VALUES('historical-retention','org','site','assignment',$1,'Synthetic old text','matched','[]','complete',clock_timestamp()-interval '40 days')",[randomUUID()]);
    const before=await inventory();await asWorker();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(publishAt)-Date.now()+50)));
    const errors=[],storage=Object.fromEntries(['save','read','remove','exists'].map(method=>[method,async()=>assert.fail(`Unexpected ${method} storage work`)]));
    const cycle=await runWorkerCycle(rehearsalTasks(f.pool,storage,{...options,runtimeRoleProfile:'worker'}),{onError:stage=>errors.push(stage)});
    assert.deepEqual(errors,[]);assert.equal(cycle.publicationSchedule,true);assert.equal(cycle.responseTextRetention,true);
    assert.equal((await f.db.query('SELECT state FROM publication_schedules WHERE id=$1',[schedule.id])).rows[0].state,'published');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM assignments WHERE publication_id=(SELECT publication_id FROM publication_schedules WHERE id=$1)',[schedule.id])).rows[0].n,1);
    assert.equal((await f.db.query("SELECT answer_text FROM attempts WHERE id='historical-retention'")).rows[0].answer_text,'[Expired]');
    assert.deepEqual(await inventory(),before);
  }finally{await f.close();}
});

test('mixed application/worker source fencing validates profiles atomically, then blocks both identities without changing business inventory',async()=>{
  const f=await fixture(),worker='understood_worker_test';try{
    await f.configure();await f.db.exec(`CREATE ROLE ${worker} LOGIN;INSERT INTO system_controls(id,revision,jobs_paused,provider_paused) VALUES('global',1,true,true)`);
    await configureRuntimePermissions(f.pool,{schema,role:worker,profile:'worker',dedicatedDatabase:true,writersStopped:true});
    const inventory=()=>withTransaction(f.pool,client=>databaseInventory(client,schema)),before=await inventory();
    await assert.rejects(fenceSourceRuntime(f.pool,{schema,roles:[role,worker],writersStopped:true}),/privileges/);
    await f.runtime();assert.equal((await verifyRuntimePermissions(f.pool,{schema})).profile,'application');await f.owner();
    await f.db.exec(`SET SESSION AUTHORIZATION ${worker}`);assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'worker'})).profile,'worker');await f.owner();
    for(const profiles of [{missing:'worker'},{[worker]:'operator'},null,[]])await assert.rejects(fenceSourceRuntime(f.pool,{schema,roles:[role,worker],profiles,writersStopped:true}));
    const result=await fenceSourceRuntime(f.pool,{schema,roles:[role,worker],profiles:{[worker]:'worker'},writersStopped:true});
    assert.equal(result.runtimeRoles,2);assert.equal(result.runtimeWriteFenceVerified,true);assert.equal(result.activationAllowed,false);assert.equal(result.productionReady,false);
    assert.deepEqual(await inventory(),before);
    for(const identity of [role,worker]){
      await f.db.exec(`SET SESSION AUTHORIZATION ${identity}`);
      await assert.rejects(f.db.query("INSERT INTO worker_health(id,state,seen_at) VALUES('forged','idle',clock_timestamp())"),error=>error.code==='42501');
      for(const table of ['organizations','sites']){
        await assert.rejects(f.db.query(`UPDATE ${table} SET id=id`),error=>error.code==='42501');
        await assert.rejects(withTransaction(f.pool,client=>client.query(`SELECT id FROM ${table} FOR SHARE`)),error=>error.code==='42501');
      }
      for(const [table,key] of Object.entries(identityLocks)){
        await assert.rejects(f.db.query(`UPDATE ${table} SET ${key}=${key}`),error=>error.code==='42501');
        await assert.rejects(withTransaction(f.pool,client=>client.query(`SELECT ${key} FROM ${table} FOR SHARE`)),error=>error.code==='42501');
      }
      for(const [table,column] of [['case_reviews','reason'],['case_repeats','status']])
        await assert.rejects(f.db.query(`UPDATE ${table} SET ${column}=${column} WHERE false`),error=>error.code==='42501');
      await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:identity===worker?'worker':'application'}),/privileges/);
      assert.equal((await withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[identity]}))).runtimeWriteFenceVerified,true);
      await f.owner();
    }
    assert.deepEqual(await inventory(),before);
    await f.db.exec(`GRANT UPDATE(id) ON sites TO ${worker}`);
    await assert.rejects(withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[worker]})),/column is not fenced/);
    await f.db.exec(`REVOKE UPDATE(id) ON sites FROM ${worker}`);
    await f.db.exec(`GRANT UPDATE(reason) ON case_reviews TO ${worker}`);
    await assert.rejects(withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[worker]})),/column is not fenced/);
    await f.db.exec(`REVOKE UPDATE(reason) ON case_reviews FROM ${worker}`);
    assert.equal((await withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles:[worker]}))).runtimeWriteFenceVerified,true);
    assert.deepEqual(await inventory(),before);
  }finally{await f.close();}
});
