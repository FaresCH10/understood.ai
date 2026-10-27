import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import * as sqlite from '../server/processing-retry.mjs';
import * as postgres from '../server/postgres/processing-retry.mjs';
import {processingRetryInput,processingRetryReceipt} from '../server/processing-retry-input.mjs';
import {receiveRecording as sqliteRecording} from '../server/recordings.mjs';
import {receiveRecording as pgRecording} from '../server/postgres/recordings.mjs';
import {processOneRecording as sqliteProcess} from '../server/recording-worker.mjs';
import {processOneRecording as pgProcess} from '../server/postgres/recording-worker.mjs';
import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {createDraft,queuePreparation,processOnePreparation} from '../server/postgres/preparation.mjs';
import {legacyWrittenQuestion} from './helpers/legacy-written-question.mjs';
import {publish,submitAnswer} from '../server/postgres/domain.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {encodeWav} from '../src/audio.ts';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential as pgCredential} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {provisionOperator,authenticateOperator} from '../server/postgres/operators.mjs';
import {retryOperationsJob,saveOperatorControl} from '../server/postgres/operations.mjs';
import {saveRetention,processOneAudioPurge} from '../server/retention.mjs';
import {saveRetention as pgSaveRetention,processOneAudioPurge as pgAudioPurge} from '../server/postgres/retention.mjs';
import {saveTextRetention,processOneTextPurge} from '../server/postgres/text-retention.mjs';
import {requestWorkerDeletion} from '../server/deletions.mjs';
import {requestWorkerDeletion as pgDeletion} from '../server/postgres/deletions.mjs';
import {configureRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},other={...owner,principal_id:'other',role:'supervisor'};
async function fixture(pg,kind='response_transcription',schema='public'){
  const raw=pg?new PGlite():openDatabase(':memory:');
  const pool={async connect(){return {query:async(sql,args)=>args?.length?raw.query(sql,args):(await raw.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  const query=async(sql,args=[])=>pg?(await raw.query(sql,args)).rows:raw.prepare(sql.replace(/\$\d+/g,'?')).all(...args);
  const objects=new Map(),storage={async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){return objects.get(row.id);},async remove(row){objects.delete(row.id);},async exists(row){return objects.has(row.id);}};
  let workerId;
  if(pg){
    if(schema!=='public')await raw.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,{schema});await raw.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
      INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Owner','owner'),('other','cedar','beirut','Other','supervisor'),('auditor','cedar','beirut','Auditor','auditor');
      INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','cedar','beirut','001','en');`);
    const draft=await createDraft(pool,owner,{requestId:randomUUID(),title:'Frozen synthetic briefing',source:CANONICAL_SOURCE},{schema});
    await queuePreparation(pool,owner,draft.id,1,{schema});await processOnePreparation(pool,{schema,integrationMode:'synthetic'});
    await legacyWrittenQuestion(pool,draft.id,{schema});
    await publish(pool,owner,draft.id,{requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker']},{schema,integrationMode:'synthetic'});workerId='worker';
  }else {seed(raw);workerId='worker-30';raw.exec("INSERT INTO staff VALUES('other','cedar','beirut','Other','supervisor',1),('auditor','cedar','beirut','Auditor','auditor',1)");}
  const assignment=(await query('SELECT * FROM assignments WHERE worker_id=$1',[workerId]))[0],worker={...owner,principal_type:'worker',principal_id:workerId};
  let row;
  if(kind==='answer_check'){
    await submitAnswer(pool,worker,assignment.id,randomUUID(),'Synthetic pending answer',{schema});row=(await query('SELECT * FROM assessment_jobs'))[0];
    await query("UPDATE assessment_jobs SET status='failed',attempts=3 WHERE id=$1",[row.id]);
  }else {
    const bytes=Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*0.2)}));
    row=pg?await pgRecording(pool,worker,assignment.id,randomUUID(),bytes,storage,{schema}):await sqliteRecording(raw,worker,assignment.id,randomUUID(),bytes,storage);
    await query("UPDATE recordings SET status='failed',attempts=3 WHERE id=$1",[row.id]);
  }
  const db=pg?pool:raw,api=pg?Object.fromEntries(Object.entries(postgres).map(([name,fn])=>[name,(db,...args)=>fn(db,...args,{schema})])):sqlite,jobId=`${kind}:${row.id}`,table=kind==='answer_check'?'assessment_jobs':'recordings';
  const adapter={async transcribe(){return {text:'Synthetic own-words answer'};},async assess(){return {outcome:'unassessable',reasons:['synthetic_fixture'],evidence:[]};}};
  return {db,raw,pool,query,storage,api,jobId,row,table,assignment,workerId,schema,close:()=>raw.close(),process:()=>kind==='answer_check'?processOneAssessment(pool,adapter,{schema}):pg?pgProcess(pool,adapter,storage,{schema}):sqliteProcess(raw,adapter,storage)};
}
const intent=context=>({requestId:randomUUID(),jobId:context.jobId,publicationId:context.publicationId,assignmentId:context.assignmentId,generation:context.generation,confirmed:true});
test('processing retry input and receipts are exact and cannot forge binding or generation',()=>{
  const input=intent({jobId:'answer_check:job',publicationId:'publication',assignmentId:'assignment',generation:0});assert.deepEqual(processingRetryInput(input.jobId,input),input);
  for(const change of [{confirmed:false},{requestId:'bad'},{generation:-1},{generation:1000001},{publicationId:''},{assignmentId:null},{jobId:'other'},{scope:'foreign'}])assert.throws(()=>processingRetryInput(input.jobId,{...input,...change}));
  const {requestId,...body}=input;assert.throws(()=>processingRetryReceipt({kind:'answer_check',job_id:'job',request_id:requestId,request_json:body,publication_id:'other',assignment_id:'assignment',generation:0,created_at:new Date()}),/receipt invalid/);
});
test('PostgreSQL customer generation reads operator retries without control writes under distinct service roles and leaves dispatch pauses enforced',async()=>{
  const f=await fixture(true,'answer_check');
  try{
    const password='Synthetic-operator-retry-password';
    await provisionOperator(f.pool,{id:randomUUID(),email:'operator@retry.example.test',password,name:'Synthetic operator'});
    const roles={application:'retry_application',worker:'retry_worker',operator:'retry_operator'};
    for(const [profile,role] of Object.entries(roles)) {
      await f.raw.exec(`CREATE ROLE ${role} LOGIN`);
      await configureRuntimePermissions(f.pool,{schema:f.schema,role,profile,dedicatedDatabase:true,writersStopped:true});
    }
    const asRole=async(profile,operation)=>{
      await f.raw.exec(`SET SESSION AUTHORIZATION ${roles[profile]}`);
      try{return await operation();}finally{await f.raw.exec('SET SESSION AUTHORIZATION postgres;RESET ROLE');}
    };
    const old=await asRole('application',async()=>intent(await f.api.getProcessingRetryContext(f.db,owner,f.jobId)));
    await asRole('operator',async()=>{
      const {session}=await authenticateOperator(f.pool,{email:'operator@retry.example.test',password},'synthetic-loopback');
      await saveOperatorControl(f.pool,session,{requestId:randomUUID(),kind:'system',revision:0,jobsPaused:true,providerPaused:true,confirmed:true});
      await retryOperationsJob(f.pool,session,{requestId:randomUUID(),kind:'assessment',jobId:f.row.id,attempts:3,confirmed:true});
    });
    // Inject a later failure only as fixture maintenance, not as a customer write.
    await f.query("UPDATE assessment_jobs SET status='failed',attempts=3 WHERE id=$1",[f.row.id]);
    await asRole('application',async()=>{
      assert.equal((await f.api.getProcessingRetryContext(f.db,owner,f.jobId)).generation,1);
      await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,f.jobId,old),/state changed/);
      await f.api.retryProcessing(f.db,owner,f.jobId,intent(await f.api.getProcessingRetryContext(f.db,owner,f.jobId)));
      await assert.rejects(f.query('INSERT INTO operator_requests DEFAULT VALUES'),error=>error.code==='42501');
      await assert.rejects(f.query("UPDATE system_controls SET jobs_paused=false WHERE id='global'"),error=>error.code==='42501');
    });
    assert.equal(await asRole('worker',f.process),false);assert.equal((await f.query('SELECT status FROM assessment_jobs WHERE id=$1',[f.row.id]))[0].status,'queued');
  }finally{await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} expired saved audio cannot be retried before or after scheduled purge`,async()=>{
  const f=await fixture(pg),oldId=randomUUID(),submissionId=randomUUID(),oldTime=new Date(Date.now()-40*86400000).toISOString();
  try{
    const row=(await f.query('SELECT * FROM recordings WHERE id=$1',[f.row.id]))[0];
    await f.query(`INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at,received_at,attempts)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'failed',$9,$10,3)`,[oldId,row.org_id,row.site_id,row.assignment_id,submissionId,row.sha256,row.duration_seconds,row.bytes,oldTime,oldTime]);
    await f.storage.save({id:oldId},await f.storage.read(row));const jobId=`response_transcription:${oldId}`;
    const context=await f.api.getProcessingRetryContext(f.db,owner,jobId);assert.equal(context.available,true);
    const input=intent(context),policy={requestId:randomUUID(),revision:0,audioDays:30,confirmed:true};
    if(pg)await pgSaveRetention(f.pool,owner,policy);else saveRetention(f.raw,owner,policy);
    assert.equal((await f.api.getProcessingRetryContext(f.db,owner,jobId)).available,false);
    await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,jobId,input),/state changed/);
    assert.equal(pg?await pgAudioPurge(f.pool,f.storage):await processOneAudioPurge(f.raw,f.storage),true);
    assert.equal(await f.storage.exists({id:oldId}),false);
    assert.equal((await f.api.getProcessingRetryContext(f.db,owner,jobId)).available,false);
    await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,jobId,input),/state changed/);assert.deepEqual(await f.api.getProcessingRetryReceipt(f.db,owner,jobId,input.requestId),{found:false});
  }finally{await f.close();}
});
test('PostgreSQL elapsed text policy and completed redaction deny historical pending-check retry',async()=>{
  const f=await fixture(true,'answer_check'),attemptId=randomUUID(),jobId=randomUUID(),submissionId=randomUUID();
  try{
    await f.query(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,assessment_status,received_at)
      VALUES($1,'cedar','beirut',$2,$3,'Synthetic old answer',NULL,'[]','pending',clock_timestamp()-interval '40 days')`,[attemptId,f.assignment.id,submissionId]);
    await f.query("INSERT INTO assessment_jobs(id,org_id,site_id,assignment_id,attempt_id,status,attempts) VALUES($1,'cedar','beirut',$2,$3,'failed',3)",[jobId,f.assignment.id,attemptId]);
    const typedId=`answer_check:${jobId}`,context=await f.api.getProcessingRetryContext(f.db,owner,typedId),input=intent(context);assert.equal(context.available,true);
    await saveTextRetention(f.pool,owner,{requestId:randomUUID(),revision:0,days:30,confirmed:true});
    assert.equal((await f.api.getProcessingRetryContext(f.db,owner,typedId)).available,false);await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,typedId,input),/state changed/);
    assert.equal(await processOneTextPurge(f.pool),true);assert.equal((await f.query('SELECT answer_text FROM attempts WHERE id=$1',[attemptId]))[0].answer_text,'[Expired]');
    assert.equal((await f.api.getProcessingRetryContext(f.db,owner,typedId)).available,false);await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,typedId,input),/state changed/);
  }finally{await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} worker deletion closes fresh retry but historical receipt recovery remains read-only`,async()=>{
  const f=await fixture(pg);
  try{
    const context=await f.api.getProcessingRetryContext(f.db,owner,f.jobId),input=intent(context);await f.api.retryProcessing(f.db,owner,f.jobId,input);
    const receipt=await f.api.getProcessingRetryReceipt(f.db,owner,f.jobId,input.requestId),code=(await f.query('SELECT code FROM workers WHERE id=$1',[f.workerId]))[0].code;
    const deletion={requestId:randomUUID(),expectedCode:code,reason:'worker_request',confirmed:true};
    if(pg)await pgDeletion(f.pool,owner,f.workerId,deletion);else requestWorkerDeletion(f.raw,owner,f.workerId,deletion);
    const next=await f.api.getProcessingRetryContext(f.db,owner,f.jobId);assert.equal(next.available,false);
    await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,f.jobId,intent(next)),/state changed/);
    const before=await f.query('SELECT * FROM recordings WHERE id=$1',[f.row.id]);
    assert.deepEqual(await f.api.retryProcessing(f.db,owner,f.jobId,input),receipt.result);assert.deepEqual(await f.api.getProcessingRetryReceipt(f.db,owner,f.jobId,input.requestId),receipt);
    assert.deepEqual(await f.query('SELECT * FROM recordings WHERE id=$1',[f.row.id]),before);
  }finally{await f.close();}
});
for(const [pg,kind] of [[false,'response_transcription'],[true,'response_transcription'],[true,'answer_check']])test(`${pg?'PostgreSQL':'SQLite'} ${kind} retry preserves accepted evidence and replays without resetting later failures`,async()=>{
  const f=await fixture(pg,kind),{api,db,jobId}=f;
  try{
    const before={publications:await f.query('SELECT * FROM publications ORDER BY id'),assignments:await f.query('SELECT * FROM assignments ORDER BY id'),attempts:await f.query('SELECT * FROM attempts ORDER BY id')};
    const context=await api.getProcessingRetryContext(db,owner,jobId);assert.equal(context.available,true);assert.equal(context.generation,0);assert.equal(context.status,'failed');
    const input=intent(context),accepted=await api.retryProcessing(db,owner,jobId,input),receipt=await api.getProcessingRetryReceipt(db,owner,jobId,input.requestId);
    assert.deepEqual(receipt.request,input);assert.deepEqual(receipt.result,accepted);assert.equal(accepted.state,'queued');
    assert.deepEqual({publications:await f.query('SELECT * FROM publications ORDER BY id'),assignments:await f.query('SELECT * FROM assignments ORDER BY id'),attempts:await f.query('SELECT * FROM attempts ORDER BY id')},before);
    for(const sql of ['UPDATE processing_retries SET generation=99','DELETE FROM processing_retries'])await assert.rejects(async()=>f.query(sql),/immutable/);
    await f.query(`UPDATE ${f.table} SET status='failed',attempts=3 WHERE id=$1`,[f.row.id]);
    const state=await f.query(`SELECT * FROM ${f.table} WHERE id=$1`,[f.row.id]);
    assert.deepEqual(await api.retryProcessing(db,owner,jobId,input),accepted);assert.deepEqual(await f.query(`SELECT * FROM ${f.table} WHERE id=$1`,[f.row.id]),state);
    assert.equal((await f.query("SELECT * FROM audit WHERE action='answer.processing_retry_requested'")).length,1);
    await assert.rejects(async()=>api.retryProcessing(db,owner,jobId,{...input,requestId:randomUUID()}),/state changed/);
    await assert.rejects(async()=>api.retryProcessing(db,other,jobId,input),/conflict/);assert.deepEqual(await api.getProcessingRetryReceipt(db,other,jobId,input.requestId),{found:false});
    for(const actor of [{...owner,principal_type:'worker'},{...owner,principal_id:'auditor',role:'auditor'},{...owner,org_id:'foreign'}])await assert.rejects(async()=>api.getProcessingRetryReceipt(db,actor,jobId,input.requestId),/Forbidden|Workspace/);
    const next=await api.getProcessingRetryContext(db,owner,jobId);assert.equal(next.generation,1);await api.retryProcessing(db,owner,jobId,intent(next));
    assert.equal(await f.process(),true);assert.equal((await api.getProcessingRetryContext(db,owner,jobId)).available,false);
    const after=await f.query(`SELECT * FROM ${f.table} WHERE id=$1`,[f.row.id]);
    await api.retryProcessing(db,owner,jobId,input);assert.deepEqual(await f.query(`SELECT * FROM ${f.table} WHERE id=$1`,[f.row.id]),after);assert.deepEqual(await api.getProcessingRetryReceipt(db,owner,jobId,input.requestId),receipt);
    await assert.rejects(async()=>api.retryProcessing(db,owner,jobId,intent(await api.getProcessingRetryContext(db,owner,jobId))),/state changed/);
    await f.query(pg?"UPDATE staff SET active=false WHERE id='maya'":"UPDATE staff SET active=0 WHERE id='maya'");await assert.rejects(async()=>api.getProcessingRetryReceipt(db,owner,jobId,input.requestId),/Forbidden/);
  }finally{await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} processing retry denies changed workers and rolls back audit failures`,async()=>{
  const f=await fixture(pg);
  try{
    const context=await f.api.getProcessingRetryContext(f.db,owner,f.jobId),input=intent(context);
    await f.query(`UPDATE workers SET active=${pg?'false':'0'} WHERE id=$1`,[f.workerId]);assert.equal((await f.api.getProcessingRetryContext(f.db,owner,f.jobId)).available,false);
    await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,f.jobId,input),/state changed/);assert.equal((await f.query('SELECT * FROM processing_retries')).length,0);
    await f.query(`UPDATE workers SET active=${pg?'true':'1'} WHERE id=$1`,[f.workerId]);
    if(pg)await f.raw.exec("CREATE FUNCTION reject_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic audit rejection';END$$;CREATE TRIGGER reject_retry_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION reject_retry_audit()");
    else f.raw.exec("CREATE TRIGGER reject_retry_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'Synthetic audit rejection');END");
    await assert.rejects(async()=>f.api.retryProcessing(f.db,owner,f.jobId,input),/Synthetic audit rejection/);
    assert.equal((await f.query('SELECT * FROM processing_retries')).length,0);assert.equal((await f.query('SELECT status,attempts FROM recordings WHERE id=$1',[f.row.id]))[0].status,'failed');
  }finally{await f.close();}
});
for(const pg of [false,true])test(`${pg?'PostgreSQL':'SQLite'} retry HTTP requires captured context before queue or receipt effects`,async()=>{
  const f=await fixture(pg,'response_transcription',pg?'understood_test_processing_retry_http':'public');let server;
  try{
    if(pg)await pgCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'maya@retry.example.test',password:'Synthetic-only-retry-password'},{schema:f.schema});
    const origin='http://127.0.0.1:3031',config={tier:'local',aiMode:'synthetic',accessMode:pg?'credential':'demo',dataClass:'synthetic',publicOrigin:origin,storage:f.storage,schema:f.schema};
    server=pg?createPostgresRehearsalServer(f.pool,config):createAppServer(f.raw,config);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/api`,contextual=createSessionContextFetch();
    const login=await contextual(base+(pg?'/auth/staff/login':'/demo/session'),{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(pg?{email:'maya@retry.example.test',password:'Synthetic-only-retry-password'}:{principal:'maya'})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],session=await (await contextual(base+'/session',{headers:{cookie}})).json(),url=base+'/processing/'+encodeURIComponent(f.jobId)+'/retries';
    const context=await f.api.getProcessingRetryContext(f.db,owner,f.jobId),input=intent(context);
    for(const header of [undefined,'invalid','0'.repeat(64)]){
      const headers={cookie,origin,'content-type':'application/json',...(header===undefined?{}:{'x-client-session-context':header})};
      for(const path of [url,url+'/'+input.requestId])assert.equal((await fetch(path,{headers})).status,409);
      assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(input)})).status,409);
    }
    assert.equal((await f.query('SELECT * FROM processing_retries')).length,0);
    const headers={cookie,origin,'content-type':'application/json','x-client-session-context':session.clientContext};
    const changedLogin=await contextual(base+(pg?'/auth/staff/login':'/demo/session'),{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(pg?{email:'maya@retry.example.test',password:'Synthetic-only-retry-password'}:{principal:'maya'})});assert.equal(changedLogin.status,200);
    const changedCookie=changedLogin.headers.get('set-cookie').split(';')[0];
    for(const path of [url,url+'/'+input.requestId])assert.equal((await fetch(path,{headers:{...headers,cookie:changedCookie}})).status,409);
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,cookie:changedCookie},body:JSON.stringify(input)})).status,409);assert.equal((await f.query('SELECT * FROM processing_retries')).length,0);
    assert.equal((await fetch(url+'?site=foreign',{headers})).status,400);
    const accepted=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(accepted.status,202);assert.match(accepted.headers.get('cache-control'),/no-store/);
    const receipt=await fetch(url+'/'+input.requestId,{headers});assert.equal(receipt.status,200);assert.deepEqual((await receipt.json()).request,input);
  }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await f.close();}
});
