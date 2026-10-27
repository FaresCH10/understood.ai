import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations,verifyMigrations} from '../server/postgres/migrate.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions,runtimeTablePolicy,fenceSourceRuntime,inspectSourceRuntimeFence} from '../server/postgres/runtime-permissions.mjs';
import {operatorColumnPolicy} from '../server/postgres/operator-permissions.mjs';
import {domainTransaction,publish,submitAnswer} from '../server/postgres/domain.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {legacyWrittenQuestion} from './helpers/legacy-written-question.mjs';
import {requestExport} from '../server/postgres/exports.mjs';
import {provisionOperator,authenticateOperator,revokeOperator} from '../server/postgres/operators.mjs';
import {operationsOverview,operationsTenants,operationsJobs,operationsAudit,saveOperatorControl,retryOperationsJob,operatorReceipt} from '../server/postgres/operations.mjs';
import {operationsTenantAccess} from '../server/postgres/operator-tenant-access.mjs';
import {readProviderControls,saveProviderPolicy,runProviderVerification} from '../server/postgres/provider-controls.mjs';
import {withTransaction} from '../server/postgres/db.mjs';
import {databaseInventory} from '../server/postgres/backup.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {request as httpRequest} from 'node:http';
import {hostedSyntheticConfig} from '../server/postgres/hosted-config.mjs';
import {startHostedApi,startHostedOperator} from '../server/postgres/hosted-runtime.mjs';
import {hostedServiceArguments} from '../scripts/postgres-hosted.mjs';
import {readFile} from 'node:fs/promises';

const schema='understood_stage_operator_acl',role='operator_runtime_test',password='Synthetic-operator-column-password';
async function fixture() {
  const db=new PGlite(),pool={async connect(){return {async query(sql,args){
    if(sql==='SELECT pg_export_snapshot() AS id')return {rows:[{id:'embedded-not-native-snapshot'}]};
    return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};},release(){}};}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog;CREATE ROLE ${role} LOGIN`);
  await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic Cedar'),('other','Other');
    INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('other','other','Other','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Synthetic Maya','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','cedar','beirut','Worker 001','en');
    INSERT INTO auth_attempts VALUES(repeat('a',64),7,clock_timestamp());`);
  await provisionOperator(pool,{id:randomUUID(),email:'operator@example.test',name:'Synthetic operator',password},{schema});
  const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},options={schema,integrationMode:'synthetic'};
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('published-draft','cedar','beirut','Synthetic source',$1,'processing')",[CANONICAL_SOURCE]);
  await db.exec("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES('prepare-original','cedar','beirut','published-draft',1,'prepare','queued',clock_timestamp())");
  await processOnePreparation(pool,options);
  await legacyWrittenQuestion(pool,'published-draft',options);
  const publication=await publish(pool,owner,'published-draft',{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker'],dueAt:null},options);
  const assignment=(await db.query('SELECT id FROM assignments WHERE publication_id=$1',[publication.id])).rows[0];
  await submitAnswer(pool,{principal_type:'worker',principal_id:'worker',org_id:'cedar',site_id:'beirut'},assignment.id,randomUUID(),'Private worker answer content',options);
  const assessment=(await db.query("UPDATE assessment_jobs SET status='failed',attempts=3 RETURNING id")).rows[0];
  const exported=await requestExport(pool,owner,{requestId:randomUUID(),publicationId:publication.id},options);
  await db.query("UPDATE report_exports SET status='failed',attempts=1 WHERE id=$1",[exported.id]);
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES('retry-draft','cedar','beirut','Private draft',$1,'failed',$2)",[CANONICAL_SOURCE,JSON.stringify({private:'Private preparation content'})]);
  await db.exec("INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,attempts,due_at) VALUES('retry-preparation','cedar','beirut','retry-draft',1,'prepare','failed',3,clock_timestamp())");
  await db.exec("INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,access_mode) VALUES(repeat('b',64),'cedar','beirut','staff','maya',clock_timestamp()+interval '1 hour','credential')");
  const configure=(profile='operator',target=role)=>configureRuntimePermissions(pool,{schema,role:target,profile,dedicatedDatabase:true,writersStopped:true});
  const runtime=()=>db.exec(`SET SESSION AUTHORIZATION ${role};SET search_path TO ${schema},pg_catalog`);
  const maintenance=()=>db.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');
  return {db,pool,options,assessmentId:assessment.id,exportId:exported.id,configure,runtime,maintenance,
    login:()=>authenticateOperator(pool,{email:'operator@example.test',password},'synthetic-operator',{schema}),close:()=>db.close()};
}

test('operator policy is positive, copied and content-minimized rather than an application profile alias',()=>{
  const columns=operatorColumnPolicy(),tables=runtimeTablePolicy('operator');
  assert.ok(tables.some(row=>row.readable));assert.ok(tables.filter(row=>!row.readable).length>90);
  assert.equal(tables.find(row=>row.table==='auth_attempts').readable,false);
  for(const table of ['publications','recordings','case_messages','staff_credentials','generated_audio'])assert.equal(tables.find(row=>row.table===table).readable,false);
  assert.equal(columns.find(row=>row.table==='briefings').select.includes('source'),false);
  assert.equal(columns.find(row=>row.table==='report_exports').select.includes('snapshot_json'),false);
  columns[0].select.push('unapproved');assert.equal(operatorColumnPolicy()[0].select.includes('unapproved'),false);
});

test('hosted service commands select an exact fixed profile without application fallback',()=>{
  assert.deepEqual(hostedServiceArguments([]),{mode:'api',service:'api'});
  for(const mode of ['operator','check-operator'])assert.deepEqual(hostedServiceArguments([mode]),{mode,service:'operator'});
  for(const mode of ['worker','check-worker'])assert.deepEqual(hostedServiceArguments([mode]),{mode,service:'worker'});
  for(const args of [['unknown'],['operator','--profile=application'],['api','operator']])assert.throws(()=>hostedServiceArguments(args));
});

test('actual operator column role authenticates and runs metadata, control and all three retries without content grants',async()=>{
  const f=await fixture();try {
    const configured=await f.configure();await f.runtime();assert.equal((await verifyMigrations(f.pool,{schema})).migrations,113);
    assert.deepEqual(await verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),configured);
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'application'}),/privileges/);
    const login=await f.login(),actor=login.session;
    assert.equal((await operationsTenants(f.pool,actor,{},f.options)).total,2);
    assert.equal((await operationsTenantAccess(f.pool,actor,{orgId:'cedar'},f.options)).total,1);
    assert.equal((await operationsOverview(f.pool,actor,f.options)).backend,'postgres');
    assert.ok((await operationsJobs(f.pool,actor,{},f.options)).total>=3);
    assert.equal((await readProviderControls(f.pool,actor,undefined,{},f.options)).productionReady,false);
    await assert.rejects(runProviderVerification(f.pool,actor,{requestId:randomUUID(),kind:'provider-verification',maxRequests:1,confirmed:true},undefined,f.options),/Provider verification unavailable/);
    const quota={requestId:randomUUID(),kind:'provider-policy',orgId:'cedar',revision:0,enabled:false,maxDailyRequests:0,confirmed:true};
    assert.equal((await saveProviderPolicy(f.pool,actor,quota,f.options)).revision,1);
    for(const [kind,jobId,attempts] of [['preparation','retry-preparation',3],['assessment',f.assessmentId,3],['export',f.exportId,1]]) {
      const input={requestId:randomUUID(),kind,jobId,attempts,confirmed:true};
      assert.equal((await retryOperationsJob(f.pool,actor,input,f.options)).status,'queued');
      assert.equal((await retryOperationsJob(f.pool,actor,input,f.options)).duplicate,true);
      assert.equal((await operatorReceipt(f.pool,actor,input.requestId,f.options)).found,true);
    }
    const suspend={requestId:randomUUID(),kind:'tenant',orgId:'cedar',revision:0,state:'suspended',reason:'pilot_review',confirmed:true};
    assert.equal((await saveOperatorControl(f.pool,actor,suspend,f.options)).state,'suspended');
    assert.equal((await saveOperatorControl(f.pool,actor,suspend,f.options)).duplicate,true);
    assert.equal((await f.db.query("SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE principal_id='maya'")).rows[0].revoked,true);
    assert.ok((await operationsAudit(f.pool,actor,{},f.options)).total>=6);
    await revokeOperator(f.pool,actor,f.options);await assert.rejects(operationsOverview(f.pool,actor,f.options),/Operator sign in required/);
    await f.maintenance();assert.deepEqual((await f.db.query('SELECT count FROM auth_attempts')).rows,[{count:7}]);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM operator_auth_attempts')).rows[0].count,3);
  }finally{await f.close();}
});

test('operator SQL cannot read private content, forge worker outcomes, change credentials, rewrite a draft or reopen sessions',async()=>{
  const f=await fixture();try {
    await f.configure();await f.runtime();const login=await f.login();
    for(const sql of ['SELECT source FROM briefings','SELECT prepared_json FROM briefings','SELECT answer_text FROM attempts',
      'SELECT snapshot_json FROM publications','SELECT snapshot_json FROM report_exports','SELECT csv FROM report_exports',
      'SELECT token_hash FROM sessions','SELECT token_hash FROM worker_grants','SELECT * FROM staff_credentials',
      'SELECT * FROM auth_attempts','DELETE FROM auth_attempts',"UPDATE attempts SET outcome='matched'",
      "UPDATE platform_operators SET password_hash='forged'","INSERT INTO platform_operators(id) VALUES('forged')",
      'DELETE FROM organizations','TRUNCATE jobs','CREATE TABLE operator_escape(id text)',
      "UPDATE briefings SET source='forged' WHERE id='retry-draft'","UPDATE briefings SET prepared_json='{\"forged\":true}' WHERE id='retry-draft'",
      "UPDATE briefings SET state='processing',prepared_json=NULL,updated_at=clock_timestamp() WHERE id='published-draft'",
      "UPDATE organizations SET id='changed' WHERE id='cedar'","UPDATE sites SET id='changed' WHERE id='beirut'",
      "UPDATE platform_operators SET id='changed'","UPDATE sessions SET revoked_at=NULL",
      "UPDATE operator_sessions SET revoked_at=NULL","UPDATE jobs SET status='ready' WHERE id='retry-preparation'",
      "UPDATE jobs SET status='queued',attempts=0,lease_token=NULL,lease_until=NULL,error=NULL,due_at=clock_timestamp()+interval '1 hour' WHERE id='retry-preparation'",
      'SELECT snapshot_available FROM report_exports WHERE snapshot_json IS NOT NULL'])
      await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    assert.equal((await f.db.query('SELECT snapshot_available FROM report_exports')).rows[0].snapshot_available,true);
    await f.db.query('UPDATE organizations SET id=id');await f.db.query('UPDATE sites SET id=id');await f.db.query('UPDATE platform_operators SET id=id');
    await f.db.query('UPDATE operator_sessions SET revoked_at=clock_timestamp()');
    await assert.rejects(f.db.query('UPDATE operator_sessions SET revoked_at=NULL'),error=>error.code==='42501');
    await assert.rejects(operationsOverview(f.pool,login.session,f.options),/Operator sign in required/);
  }finally{await f.close();}
});

test('operator admission rejects whole-table, hidden/future-column, delegate and PUBLIC grant drift',async()=>{
  const f=await fixture();try {
    await f.configure();
    for(const [grant,revoke] of [
      [`GRANT SELECT ON briefings TO ${role}`,`REVOKE SELECT ON briefings FROM ${role}`],
      [`GRANT SELECT(source) ON briefings TO ${role}`,`REVOKE SELECT(source) ON briefings FROM ${role}`],
      [`GRANT UPDATE(source) ON briefings TO ${role}`,`REVOKE UPDATE(source) ON briefings FROM ${role}`],
      [`GRANT SELECT(id) ON sites TO ${role} WITH GRANT OPTION`,`REVOKE GRANT OPTION FOR SELECT(id) ON sites FROM ${role}`],
      ['GRANT SELECT(id) ON sites TO PUBLIC','REVOKE SELECT(id) ON sites FROM PUBLIC'],
    ]) {
      await f.db.exec(grant);await f.runtime();await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/privileges/);
      await f.maintenance();await f.db.exec(revoke);await f.configure();
    }
    await f.db.exec(`ALTER TABLE workers ADD COLUMN future_private text;GRANT SELECT(future_private) ON workers TO ${role}`);await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/privileges/);
    await f.maintenance();await f.db.exec(`REVOKE SELECT(future_private) ON workers FROM ${role}`);await f.runtime();
    assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'operator'})).restricted,true);
  }finally{await f.close();}
});

test('three-profile durable fence removes operator column writes as well as API and worker table writes',async()=>{
  const f=await fixture();try {
    await f.db.exec('CREATE ROLE api_runtime_test LOGIN;CREATE ROLE worker_runtime_test LOGIN');
    await f.configure('application','api_runtime_test');await f.configure('worker','worker_runtime_test');await f.configure();
    await f.runtime();const actor=(await f.login()).session;
    await saveOperatorControl(f.pool,actor,{requestId:randomUUID(),kind:'system',revision:0,jobsPaused:true,providerPaused:true,confirmed:true},f.options);
    await f.maintenance();const inventory=()=>withTransaction(f.pool,client=>databaseInventory(client,schema)),before=await inventory();
    const roles=['api_runtime_test','worker_runtime_test',role],profiles={worker_runtime_test:'worker',[role]:'operator'};
    const fence=await fenceSourceRuntime(f.pool,{schema,roles,profiles,writersStopped:true});assert.equal(fence.runtimeRoles,3);assert.equal(fence.activationAllowed,false);
    assert.deepEqual(await inventory(),before);await f.runtime();
    for(const sql of ['UPDATE sessions SET revoked_at=clock_timestamp()',"UPDATE system_controls SET jobs_paused=false",'UPDATE organizations SET id=id'])
      await assert.rejects(f.db.query(sql),error=>error.code==='42501',sql);
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/privileges/);
    assert.equal((await withTransaction(f.pool,client=>inspectSourceRuntimeFence(client,{schema,roles}))).runtimeWriteFenceVerified,true);
    await f.maintenance();assert.deepEqual(await inventory(),before);
  }finally{await f.close();}
});

test('operator admission rejects missing or rewritten value guards and a non-generated eligibility column',async()=>{
  const f=await fixture();try {
    await f.configure();
    const original=(await f.db.query("SELECT pg_get_functiondef('restrict_column_runtime_update()'::regprocedure) AS definition")).rows[0].definition;
    await f.db.exec('ALTER TABLE briefings DISABLE TRIGGER column_runtime_update');await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/runtime guards/);
    await f.maintenance();await f.db.exec('ALTER TABLE briefings ENABLE TRIGGER column_runtime_update');
    await f.db.exec('CREATE OR REPLACE FUNCTION restrict_column_runtime_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/runtime guards/);
    await f.maintenance();await f.db.exec(original);await f.runtime();
    assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'operator'})).restricted,true);
    await f.maintenance();await f.db.exec(original.replace("before_row->>'status'","before_row->>'status\r'"));await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/runtime guards/);
    await f.maintenance();await f.db.exec(original);await f.runtime();
    assert.equal((await verifyRuntimePermissions(f.pool,{schema,profile:'operator'})).restricted,true);
    await f.maintenance();await f.db.exec('ALTER TABLE report_exports ALTER COLUMN snapshot_available DROP EXPRESSION');await f.runtime();
    await assert.rejects(verifyRuntimePermissions(f.pool,{schema,profile:'operator'}),/runtime guards/);
  }finally{await f.close();}
});

test('dedicated hosted operator startup refuses owner/application authority and serves actual HTTP under its column-only role',async()=>{
  const f=await fixture(),origin='https://operations.example.test';let server;
  const config={...hostedSyntheticConfig({UNDERSTOOD_TIER:'staging',UNDERSTOOD_AI_MODE:'synthetic',UNDERSTOOD_ACCESS_MODE:'credential',
    UNDERSTOOD_DATA_CLASS:'synthetic',UNDERSTOOD_PUBLIC_ORIGIN:origin,UNDERSTOOD_CUSTOMER_ORIGIN:'https://customer.example.test',
    UNDERSTOOD_POSTGRES_SCHEMA:schema,UNDERSTOOD_POSTGRES_URL:'postgres://fixture@example.test/synthetic',UNDERSTOOD_POSTGRES_TLS:'true',
    UNDERSTOOD_OPERATOR_ACCESS:'true',UNDERSTOOD_TRUSTED_PROXY_NETWORKS:'["127.0.0.1/32"]'},{service:'operator'}),port:0};
  try {
    await assert.rejects(startHostedOperator(f.pool,config),/unprivileged/);
    await f.configure('application');await f.runtime();await assert.rejects(startHostedOperator(f.pool,config),/privileges/);
    await f.maintenance();await f.configure();await f.runtime();
    await assert.rejects(startHostedApi(f.pool,{},config),/Invalid hosted API service/);
    server=await startHostedOperator(f.pool,config);assert.equal(server.requestTimeout,30000);assert.equal(server.headersTimeout,15000);
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(path,{method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{
      const req=httpRequest(base+path,{method,headers:{host:'operations.example.test','x-forwarded-proto':'https','x-forwarded-for':'198.51.100.20',
        ...(body?{'content-length':Buffer.byteLength(body)}:{}),...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.end(body);
    });
    const entry=await request('/');assert.equal(entry.status,200);assert.match(entry.text,/<title>Understood Operations<\/title>/);
    assert.equal(entry.headers['cache-control'],'no-store');assert.match(entry.headers['content-security-policy'],/worker-src 'none'/);
    assert.equal(entry.headers['permissions-policy'],'microphone=(), camera=(), geolocation=()');
    const operatorScript=entry.text.match(/src="(\/assets\/[^"]+\.js)"/)[1];assert.equal((await request(operatorScript)).status,200);
    const customerHtml=await readFile('dist/index.html','utf8'),customerScript=customerHtml.match(/src="(\/assets\/[^"]+\.js)"/)[1];
    assert.notEqual(operatorScript,customerScript);assert.equal((await request(customerScript)).status,404);
    for(const path of ['/sw.js','/manifest.webmanifest','/worker-import-template.csv','/.vite/manifest.json'])assert.equal((await request(path)).status,404,path);
    assert.equal((await request('/api/session')).status,404);
    assert.equal((await request('/api/overview')).status,404);
    const login=await request('/api/ops/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'operator@example.test',password})});
    assert.equal(login.status,200);const session=JSON.parse(login.text),cookie=login.headers['set-cookie'][0].split(';')[0];
    assert.match(cookie,/^__Host-understood_operator=/);
    const overview=await request('/api/ops/overview',{headers:{cookie,'x-operator-context':session.clientContext}});
    assert.equal(overview.status,200);assert.equal(JSON.parse(overview.text).backend,'postgres');
    assert.equal((await request('/api/ops/overview',{headers:{cookie}})).status,409);
    assert.equal((await request('/api/ops/login',{method:'POST',headers:{origin:'https://customer.example.test'},body:'{bad'})).status,403);
    assert.equal((await fetch(base+'/api/health')).status,200);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
});
