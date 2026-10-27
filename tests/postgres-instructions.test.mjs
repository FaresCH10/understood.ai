import {processOneAssessment} from '../server/postgres/assessment-worker.mjs';
import {assignWorkerPassword} from '../server/postgres/worker-credentials.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {startInstructionSend,instructionAudienceOverview,instructionSendStatus,completeInstructionSend,
  retryInstructionSend,processOneInstructionSend,instructionDeliveryContentForAssignment} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {workerBriefings,workerBriefing} from '../server/postgres/read-models.mjs';
import {acknowledgeAssignment} from '../server/postgres/acknowledgments.mjs';
import {workerRequestReceipt,listPublicationResponses,getPublicationResponse} from '../server/postgres/responses.mjs';
import {readPublicationReport} from '../server/postgres/reports.mjs';
import {submitAnswer} from '../server/postgres/domain.mjs';
import {receiveRecording} from '../server/postgres/recordings.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential,issueWorkerGrant} from '../server/postgres/auth.mjs';

const options={schema:'understood_test_instructions',integrationMode:'synthetic'};
const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
const worker={principal_type:'worker',principal_id:'w1',org_id:'a',site_id:'a'};
const origin='http://127.0.0.1:3020';
const scope={schema:options.schema};
const instruction=()=>({requestId:randomUUID(),title:'Shelf handover',source:CANONICAL_SOURCE,audience:{type:'all'}});

async function fixture() {
  const db=new PGlite();const queries=[];
  const client={async query(sql,values){queries.push(sql);return values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${options.schema}; SET search_path TO ${options.schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.query("INSERT INTO organizations(id,name) VALUES ('a','A'),('b','B')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('a','a','A','UTC'),('c','a','C','UTC'),('b','b','B','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('owner','a','a','Owner','owner'),('other','b','b','Other','owner'),('auditor','a','a','Auditor','auditor')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('w1','a','a','001','en'),('w2','a','a','002','ur'),('w3','a','c','003','ar'),('wb','b','b','001','en')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('wh','a','a','004','hi')");
  await db.query("INSERT INTO crews(id,org_id,site_id,name) VALUES ('empty','a','a','Empty crew')");
  await assignWorkerPassword(pool,owner,'w1',{expectedCode:'001',workerId:'001',password:'Assigned synthetic worker password',confirmed:true},scope);
  return {db,pool,queries};
}

async function prepare(pool) {
  assert.equal(await processOnePreparation(pool,{schema:options.schema,integrationMode:'synthetic'}),true);
}

function wav() {
  const bytes=Buffer.alloc(44+16000*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);
  bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let i=0;i<16000;i++)bytes.writeInt16LE(Math.round(4000*Math.sin(i/10)),44+i*2);
  return bytes;
}
const storage={async save(){},async read(){throw new Error('unused');},async remove(){}};

test('PostgreSQL instruction send prepares one logical publication, freezes modes, delivers ready languages and replays safely',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    assert.deepEqual((await instructionAudienceOverview(pool,owner,scope)).workers,{total:3,byLanguage:{en:1,ar:0,ur:1,hi:1},notSelected:0});
    assert.deepEqual((await instructionAudienceOverview(pool,owner,scope)).crews.map(crew=>crew.id),['empty']);
    await assert.rejects(instructionAudienceOverview(pool,{...owner,role:'auditor'},scope),/Forbidden/);
    assert.deepEqual((await instructionAudienceOverview(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},scope)).workers,{total:1,byLanguage:{en:1,ar:0,ur:0},notSelected:0});
    await assert.rejects(instructionAudienceOverview(pool,worker,scope),/Forbidden/);

    const input={...instruction(),responseMode:'question',deliveryMode:'both'};
    const started=await startInstructionSend(pool,owner,input,scope);
    assert.equal(started.state,'preparing');assert.equal(started.audience.count,3);assert.equal(started.delivered,0);assert.equal(started.undelivered,3);
    assert.deepEqual(started.undeliveredReasons,[]);assert.equal(started.publicationId,null);
    await prepare(pool);
    const result=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(result.state,'published');assert.equal(result.delivered,2);assert.equal(result.undelivered,1);
    assert.deepEqual(result.undeliveredReasons,[{reason:'language_unavailable',language:'hi',count:1}]);
    const snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[result.publicationId])).rows[0].snapshot_json;
    assert.equal(snapshot.responseMode,'question');assert.equal(snapshot.deliveryMode,'both');
    assert.deepEqual(Object.keys(snapshot.languages).sort(),['en','ur']);
    const report=await readPublicationReport(pool,owner,{schema:options.schema,publicationId:result.publicationId,filters:{}});
    assert.equal(report.responseMode,'question');assert.equal(report.deliveryMode,'both');assert.equal(report.metrics.assigned,2);
    assert.equal(report.delivery.captured,3);assert.equal(report.delivery.delivered,2);assert.equal(report.delivery.undelivered,1);
    assert.deepEqual(report.delivery.states,{preparing:0,available:2,blocked:0,failed:1,withdrawn:0});
    assert.deepEqual(report.delivery.undeliveredReasons,[{reason:'language_unavailable',language:'hi',count:1}]);
    const assignments=(await db.query('SELECT id,worker_id,language FROM assignments WHERE publication_id=$1 ORDER BY worker_id',[result.publicationId])).rows;
    assert.deepEqual(assignments.map(row=>row.worker_id),['w1','w2']);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM assignments WHERE publication_id=$1 AND worker_id='wh'",[result.publicationId])).rows[0].n,0);

    const replay=await startInstructionSend(pool,owner,input,scope);
    assert.equal(replay.duplicate,true);assert.equal(replay.publicationId,result.publicationId);assert.equal(replay.state,'published');
    await assert.rejects(startInstructionSend(pool,owner,{...input,title:'Different title'},scope),/Instruction request conflict/);
    await assert.rejects(startInstructionSend(pool,owner,{...input,requestId:randomUUID(),responseMode:'quiz'},scope),/Invalid instruction request/);
    const done=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(done.duplicate,true);assert.equal(done.publicationId,result.publicationId);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publications WHERE briefing_id=$1',[input.requestId])).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM jobs WHERE briefing_id=$1',[input.requestId])).rows[0].n,1);
    assert.equal((await instructionSendStatus(pool,owner,input.requestId,scope)).state,'published');
    await assert.rejects(instructionSendStatus(pool,worker,input.requestId,scope),/Forbidden/);
    await assert.rejects(instructionSendStatus(pool,{...owner,principal_id:'other',org_id:'b',site_id:'b'},input.requestId,scope),/Instruction unavailable/);
    await assert.rejects(instructionSendStatus(pool,owner,'not-a-uuid',scope),/Invalid instruction request/);

    await assert.rejects(startInstructionSend(pool,owner,{...instruction(),requestId:randomUUID(),audience:{type:'crew',crewId:'empty'}},scope),/Instruction audience is empty/);
    await assert.rejects(startInstructionSend(pool,owner,{...instruction(),requestId:randomUUID(),audience:{type:'crew',crewId:'missing'}},scope),/Crew unavailable/);
    await assert.rejects(acknowledgeAssignment(pool,worker,assignments[0].id,randomUUID(),scope),/This instruction requires an answer/);
    await assert.rejects(startInstructionSend(pool,{...owner,principal_id:'auditor',role:'auditor'},{...instruction(),requestId:randomUUID()},scope),/Forbidden/);
  }finally{await db.close();}
});

test('PostgreSQL acknowledgment-only sends hide the question, reject answers and record an immutable scoped receipt once',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const input={...instruction(),responseMode:'acknowledge',deliveryMode:'text'};
    await startInstructionSend(pool,owner,input,scope);
    await prepare(pool);
    const result=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(result.state,'published');assert.equal(result.delivered,2);assert.equal(result.undelivered,1);
    const assignments=(await db.query('SELECT id,worker_id,language FROM assignments WHERE publication_id=$1 ORDER BY worker_id',[result.publicationId])).rows;
    const [first,second]=assignments;
    const inbox=await workerBriefings(pool,worker,scope);
    const item=inbox.items.find(value=>value.publicationId===result.publicationId);
    assert.ok(item);assert.equal(item.responseMode,'acknowledge');assert.equal(item.deliveryMode,'text');assert.equal(item.assessmentStatus,null);
    assert.equal(inbox.counts.todo,1);assert.equal(inbox.counts.sent,0);
    const detail=await workerBriefing(pool,worker,first.id,scope);
    assert.equal(detail.responseMode,'acknowledge');assert.equal(detail.deliveryMode,'text');
    assert.equal(detail.content.question,undefined);assert.equal(detail.content.speech,null);assert.equal(detail.speechAvailable,null);
    assert.equal(detail.assessmentStatus,null);assert.equal(detail.acknowledgedAt,undefined);
    await assert.rejects(submitAnswer(pool,worker,first.id,randomUUID(),'Done.',scope),/only requires confirmation/);
    await assert.rejects(receiveRecording(pool,worker,first.id,randomUUID(),wav(),storage,scope),/only requires confirmation/);

    await assert.rejects(acknowledgeAssignment(pool,worker,first.id,'not-a-uuid',scope),/Invalid acknowledgment request/);
    await assert.rejects(acknowledgeAssignment(pool,owner,first.id,randomUUID(),scope),/Forbidden/);
    await assert.rejects(acknowledgeAssignment(pool,{...worker,principal_id:'w2'},first.id,randomUUID(),scope),/Assignment unavailable/);
    await assert.rejects(acknowledgeAssignment(pool,{...worker,principal_id:'wb',org_id:'b',site_id:'b'},first.id,randomUUID(),scope),/Assignment unavailable/);

    const requestId=randomUUID(),ack=await acknowledgeAssignment(pool,worker,first.id,requestId,scope);
    assert.equal(ack.id,requestId);assert.equal(ack.duplicate,false);assert.ok(Date.parse(ack.receivedAt));
    const replay=await acknowledgeAssignment(pool,worker,first.id,randomUUID(),scope);
    assert.equal(replay.id,requestId);assert.equal(replay.duplicate,true);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM acknowledgments WHERE assignment_id=$1',[first.id])).rows[0].n,1);
    const receipt=await workerRequestReceipt(pool,worker,first.id,'acknowledge',requestId,scope);
    assert.deepEqual(receipt,{id:requestId,status:'acknowledged',receivedAt:ack.receivedAt,duplicate:true});
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM audit WHERE action='instruction.acknowledged' AND object_id=$1`,[first.id])).rows[0].n,1);
    await assert.rejects(db.query('UPDATE acknowledgments SET received_at=clock_timestamp() WHERE request_id=$1',[requestId]),/immutable/);
    await assert.rejects(db.query('DELETE FROM acknowledgments WHERE request_id=$1',[requestId]),/immutable/);

    const sent=await workerBriefings(pool,worker,scope,{view:'sent'});
    const done=sent.items.find(value=>value.publicationId===result.publicationId);
    assert.ok(done);assert.equal(done.assessmentStatus,'complete');assert.ok(done.acknowledgedAt);
    assert.equal((await workerBriefings(pool,worker,scope,{view:'todo'})).items.some(value=>value.publicationId===result.publicationId),false);
    const detailDone=await workerBriefing(pool,worker,first.id,scope);
    assert.equal(detailDone.assessmentStatus,'complete');assert.ok(detailDone.acknowledgedAt);
    const responses=await listPublicationResponses(pool,owner,result.publicationId,{status:'acknowledged'},scope);
    assert.equal(responses.total,1);assert.equal(responses.items[0].status,'acknowledged');assert.equal(responses.items[0].language,'en');assert.ok(responses.items[0].receivedAt);
    const staffDetail=await getPublicationResponse(pool,owner,result.publicationId,first.id,{},scope);
    assert.equal(staffDetail.responseMode,'acknowledge');assert.equal(staffDetail.deliveryMode,'text');
    assert.equal(staffDetail.question,null);assert.equal(staffDetail.workerQuestion,null);assert.ok(staffDetail.acknowledgedAt);assert.deepEqual(staffDetail.receipts,[]);
    const report=await readPublicationReport(pool,owner,{schema:options.schema,publicationId:result.publicationId,filters:{}});
    assert.equal(report.responseMode,'acknowledge');assert.equal(report.deliveryMode,'text');
    assert.equal(report.metrics.assigned,2);assert.equal(report.metrics.responses,1);assert.equal(report.metrics.acknowledged,1);
    assert.equal(report.metrics.unassessed,0);assert.equal(report.metrics.completion,50);
    assert.equal(report.delivery.captured,3);assert.equal(report.delivery.delivered,2);assert.equal(report.delivery.undelivered,1);
    assert.deepEqual(report.delivery.states,{preparing:0,available:2,blocked:0,failed:1,withdrawn:0});
    const row=report.rows.find(entry=>entry[0]==='001');assert.equal(row[2],'acknowledged');assert.equal(row[3],'');assert.equal(row[6],'acknowledge');assert.equal(row[7],'text');

    await db.query("UPDATE assignments SET due_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[second.id]);
    await assert.rejects(acknowledgeAssignment(pool,{...worker,principal_id:'w2'},second.id,randomUUID(),scope),/deadline passed/);
  }finally{await db.close();}
});

const workerOf=(id)=>({principal_type:'worker',principal_id:id,org_id:'a',site_id:'a'});

test('PostgreSQL late-prepared language rejoins the original publication and serves delivery content once',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const input={...instruction(),responseMode:'question',deliveryMode:'both'};
    const started=await startInstructionSend(pool,owner,input,scope);
    assert.equal(started.state,'preparing');assert.equal(started.audience.count,3);
    assert.deepEqual(started.deliveryStates,{preparing:3,available:0,blocked:0,failed:0,withdrawn:0});
    await prepare(pool);
    const first=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(first.state,'published');assert.equal(first.delivered,2);assert.equal(first.undelivered,1);
    assert.deepEqual(first.deliveryStates,{preparing:0,available:2,blocked:0,failed:1,withdrawn:0});
    assert.deepEqual(first.undeliveredReasons,[{reason:'language_unavailable',language:'hi',count:1}]);
    assert.equal(first.retryable,true);
    const publicationId=first.publicationId;
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publications WHERE briefing_id=$1',[input.requestId])).rows[0].n,1);

    await db.query(`UPDATE briefings SET prepared_json=jsonb_set(prepared_json,'{languages,hi}',prepared_json->'languages'->'en') WHERE id=$1`,[input.requestId]);
    const retryRequestId=randomUUID();
    const retried=await retryInstructionSend(pool,owner,input.requestId,{requestId:retryRequestId},scope);
    assert.equal(retried.retried,1);assert.equal(retried.released,1);
    assert.equal(retried.publicationId,publicationId);assert.equal(retried.delivered,3);assert.equal(retried.undelivered,0);
    assert.deepEqual(retried.deliveryStates,{preparing:0,available:3,blocked:0,failed:0,withdrawn:0});
    assert.deepEqual(retried.undeliveredReasons,[]);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publications WHERE briefing_id=$1',[input.requestId])).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignments WHERE publication_id=$1',[publicationId])).rows[0].n,3);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publication_report_audience WHERE publication_id=$1',[publicationId])).rows[0].n,3);
    const late=(await db.query("SELECT content_json,content_hash,assignment_id FROM instruction_deliveries WHERE request_id=$1 AND language='hi'",[input.requestId])).rows[0];
    assert.ok(late.content_json);assert.ok(late.content_hash);assert.ok(late.assignment_id);

    const replay=await retryInstructionSend(pool,owner,input.requestId,{requestId:retryRequestId},scope);
    assert.equal(replay.duplicate,true);assert.equal(replay.retried,1);assert.equal(replay.released,1);

    const inbox=await workerBriefings(pool,workerOf('wh'),scope);
    const item=inbox.items.find(value=>value.publicationId===publicationId);
    assert.ok(item);assert.equal(item.language,'hi');assert.ok(item.title.length>0);
    const detail=await workerBriefing(pool,workerOf('wh'),item.id,scope);
    assert.equal(detail.language,'hi');assert.ok(detail.content.text.length>0);
    const delivered=await instructionDeliveryContentForAssignment(pool,'a','a','wh',item.id,scope);
    assert.equal(delivered.language,'hi');assert.ok(delivered.content.text.length>0);
    assert.equal(await instructionDeliveryContentForAssignment(pool,'a','a','w2',item.id,scope),null);
  }finally{await db.close();}
});

test('PostgreSQL retries re-check workers, replay per receipt and stop after three attempts',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const input={...instruction(),responseMode:'question',deliveryMode:'both'};
    await startInstructionSend(pool,owner,input,scope);
    await prepare(pool);
    await db.query(`UPDATE briefings SET prepared_json=jsonb_set(prepared_json,'{languages,hi}',prepared_json->'languages'->'en') WHERE id=$1`,[input.requestId]);
    await db.query("UPDATE workers SET active=false WHERE id='w1'");
    const first=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(first.delivered,2);assert.equal(first.undelivered,1);
    assert.deepEqual(first.deliveryStates,{preparing:0,available:2,blocked:1,failed:0,withdrawn:0});
    assert.deepEqual(first.undeliveredReasons,[{reason:'worker_inactive',language:'en',count:1}]);

    const retryId=randomUUID();
    const blocked=await retryInstructionSend(pool,owner,input.requestId,{requestId:retryId},scope);
    assert.equal(blocked.retried,1);assert.equal(blocked.released,0);assert.equal(blocked.delivered,2);
    assert.equal(blocked.deliveryStates.blocked,1);
    const replay=await retryInstructionSend(pool,owner,input.requestId,{requestId:retryId},scope);
    assert.equal(replay.duplicate,true);assert.equal(replay.retried,1);assert.equal(replay.released,0);

    await db.query("UPDATE workers SET active=true WHERE id='w1'");
    const released=await retryInstructionSend(pool,owner,input.requestId,{requestId:randomUUID()},scope);
    assert.equal(released.retried,1);assert.equal(released.released,1);assert.equal(released.delivered,3);assert.equal(released.undelivered,0);
    assert.equal((await db.query("SELECT attempts FROM instruction_deliveries WHERE request_id=$1 AND worker_id='w1'",[input.requestId])).rows[0].attempts,2);
    const empty=await retryInstructionSend(pool,owner,input.requestId,{requestId:randomUUID()},scope);
    assert.equal(empty.retried,0);assert.equal(empty.retryable,false);

    const limitRequest=randomUUID();
    await startInstructionSend(pool,owner,{...input,requestId:limitRequest},scope);
    await prepare(pool);
    await db.query(`UPDATE briefings SET prepared_json=jsonb_set(prepared_json,'{languages,hi}',prepared_json->'languages'->'en') WHERE id=$1`,[limitRequest]);
    await db.query("UPDATE workers SET language='ar' WHERE id='w1'");
    const changed=await completeInstructionSend(pool,owner,limitRequest,scope);
    assert.equal(changed.delivered,2);
    assert.deepEqual(changed.undeliveredReasons,[{reason:'language_changed',language:'en',count:1}]);
    for(let attempt=1;attempt<=3;attempt+=1) {
      const result=await retryInstructionSend(pool,owner,limitRequest,{requestId:randomUUID()},scope);
      assert.equal(result.retried,1);assert.equal(result.released,0);
      assert.equal((await db.query("SELECT attempts FROM instruction_deliveries WHERE request_id=$1 AND worker_id='w1'",[limitRequest])).rows[0].attempts,attempt);
    }
    await assert.rejects(retryInstructionSend(pool,owner,limitRequest,{requestId:randomUUID()},scope),/Instruction retry limit reached/);
    assert.equal((await instructionSendStatus(pool,owner,limitRequest,scope)).retryable,false);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publications WHERE briefing_id=$1',[limitRequest])).rows[0].n,1);
  }finally{await db.close();}
});

test('PostgreSQL background completion releases late content after preparation',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const requestId=randomUUID();
    await startInstructionSend(pool,owner,{...instruction(),requestId,responseMode:'question',deliveryMode:'both'},scope);
    await prepare(pool);
    const first=await completeInstructionSend(pool,owner,requestId,scope);
    assert.equal(first.delivered,2);
    const late=(await db.query("SELECT jsonb_set(prepared_json,'{languages,hi}',prepared_json->'languages'->'en') AS prepared FROM briefings WHERE id=$1",[requestId])).rows[0].prepared;

    const queued=await retryInstructionSend(pool,owner,requestId,{requestId:randomUUID()},scope);
    assert.equal(queued.retried,1);assert.equal(queued.released,0);assert.equal(queued.deliveryStates.preparing,1);
    assert.equal((await db.query('SELECT state FROM briefings WHERE id=$1',[requestId])).rows[0].state,'processing');
    await db.query("UPDATE briefings SET state='ready',prepared_json=$2 WHERE id=$1",[requestId,JSON.stringify(late)]);
    assert.equal(await processOneInstructionSend(pool,scope),true);
    const delivered=await instructionSendStatus(pool,owner,requestId,scope);
    assert.equal(delivered.state,'published');assert.equal(delivered.delivered,3);assert.equal(delivered.undelivered,0);
    assert.deepEqual(delivered.deliveryStates,{preparing:0,available:3,blocked:0,failed:0,withdrawn:0});
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publications WHERE briefing_id=$1',[requestId])).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignments WHERE publication_id=$1',[first.publicationId])).rows[0].n,3);
  }finally{await db.close();}
});

test('PostgreSQL a passed deadline blocks late release and leaves reminders for delivered recipients',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    const requestId=randomUUID(),dueAt=new Date(Date.now()+600000).toISOString(),realNow=Date.now;
    try {
    await startInstructionSend(pool,owner,{...instruction(),requestId,dueAt,reminderMinutes:60,responseMode:'question',deliveryMode:'both'},scope);
    await prepare(pool);
    const first=await completeInstructionSend(pool,owner,requestId,scope);
    assert.equal(first.delivered,2);assert.equal(first.dueAt,dueAt);assert.equal(first.reminderMinutes,60);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignment_reminders WHERE publication_id=$1',[first.publicationId])).rows[0].n,2);
    const late=(await db.query("SELECT jsonb_set(prepared_json,'{languages,hi}',prepared_json->'languages'->'en') AS prepared FROM briefings WHERE id=$1",[requestId])).rows[0].prepared;
    const queued=await retryInstructionSend(pool,owner,requestId,{requestId:randomUUID()},scope);
    assert.equal(queued.retried,1);assert.equal(queued.released,0);
    Date.now=()=>realNow()+1200000;
    await db.query("UPDATE briefings SET state='ready',prepared_json=$2 WHERE id=$1",[requestId,JSON.stringify(late)]);
    assert.equal(await processOneInstructionSend(pool,scope),true);
    const after=await instructionSendStatus(pool,owner,requestId,scope);
    assert.equal(after.state,'published');assert.equal(after.delivered,2);assert.equal(after.undelivered,1);
    assert.deepEqual(after.undeliveredReasons,[{reason:'deadline_passed',language:'hi',count:1}]);
    assert.equal(after.retryable,false);
    await assert.rejects(retryInstructionSend(pool,owner,requestId,{requestId:randomUUID()},scope),/Instruction deadline passed/);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM assignment_reminders WHERE publication_id=$1',[first.publicationId])).rows[0].n,2);
    } finally {Date.now=realNow;}
  }finally{await db.close();}
});

async function withHttp(f,run,serverOptions={}) {
  const server=createPostgresRehearsalServer(f.pool,{tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,dataClass:'synthetic',schema:options.schema,...serverOptions});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,cookie,init={})=>fetch(`${base}/api${path}`,{...init,headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...init.headers}});
  try {await run({request});} finally {await new Promise(resolve=>server.close(resolve));}
}
const cookieOf=(response)=>response.headers.get('set-cookie').split(';')[0];
const post=(body)=>({method:'POST',body:JSON.stringify(body)});

test('configured provider sends stay queued during HTTP reads and publish generated speech through the worker',async()=>{
  const {db,pool}=await fixture(),objects=new Map();
  const storage={async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){return objects.get(row.id);},async remove(row){objects.delete(row.id);}};
  const source='Move the red ladder to the north bay before the night shift.';
  const adapter={provenance:{adapter:'synthetic-http-fixture',dataClass:'synthetic',textModel:'fixture',speechModel:'fixture',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:['en','hi','ur'],speechLanguages:['en','hi','ur']},
    async prepare(){return {title:'Ladder handover',facts:[source],askedFacts:[source],question:'What should happen to the red ladder before the night shift?'};},
    async checkPreparation(){return {sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:[{factIndex:0,quote:source}],askedFactIndexes:[0],reasons:[]};},
    async translate(_,language){const text=language==='hi'?'लाल सीढ़ी':'سرخ سیڑھی';return {title:text,text,question:text+'?'};},
    async checkTranslation(){return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};},async speech(){return wav();}};
  try{
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'Synthetic HTTP staff password'},scope);
    await withHttp({pool},async({request})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'Synthetic HTTP staff password'})));
      const context=(await (await request('/session',staff)).json()).clientContext,headers={'x-client-session-context':context};
      const payload={...instruction(),source,deliveryMode:'both',responseMode:'question'};
      const response=await request('/instructions/send',staff,{...post(payload),headers});
      assert.equal(response.status,201);assert.equal((await response.json()).state,'preparing');
      const status=await request('/instructions/sends/'+payload.requestId,staff,{headers});
      assert.equal(status.status,200);assert.equal((await status.json()).state,'preparing');
      assert.equal((await db.query('SELECT attempts FROM jobs WHERE briefing_id=$1',[payload.requestId])).rows[0].attempts,0);
      assert.equal(await processOnePreparation(pool,{...options,adapter,storage}),true);
      const complete=await request('/instructions/sends/'+payload.requestId,staff,{headers});
      assert.equal(complete.status,200);const result=await complete.json();assert.equal(result.state,'published');assert.equal(result.delivered,3);
      const snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[result.publicationId])).rows[0].snapshot_json;
      assert.ok(snapshot.artifactBundle);assert.equal(snapshot.rubric.mode,'multiple-choice');assert.equal(objects.size,6);
    },{preparationAdapter:adapter,storage});
  }finally{await db.close();}
});

test('PostgreSQL instruction and acknowledgment HTTP routes enforce session context, scopes and idempotent replay',async()=>{
  const f=await fixture(),{db,pool}=f;
  try {
    let httpRequestId;
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'a',siteId:'a',email:'owner@example.test',password:'long-enough-password'},scope);
    await provisionStaffCredential(pool,{staffId:'other',orgId:'b',siteId:'b',email:'other@example.test',password:'long-enough-password'},scope);
    await withHttp(f,async({request})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:'long-enough-password'})));
      const staffContext=(await (await request('/session',staff)).json()).clientContext;
      const auth={'x-client-session-context':staffContext};
      assert.equal((await request('/instructions/audience',staff)).status,409);
      const audience=await request('/instructions/audience',staff,{headers:auth});assert.equal(audience.status,200);
      assert.deepEqual((await audience.json()).workers,{total:3,byLanguage:{en:1,ar:0,ur:1,hi:1},notSelected:0});

      const payload={...instruction(),responseMode:'acknowledge',deliveryMode:'text'};httpRequestId=payload.requestId;
      assert.equal((await request('/instructions/send',staff,post(payload))).status,409);
      assert.equal((await request('/instructions/send',staff,{...post({...payload,requestId:randomUUID(),audience:{type:'crew',crewId:'empty'}}),headers:auth})).status,400);
      const sent=await request('/instructions/send',staff,{...post(payload),headers:auth});
      assert.equal(sent.status,201);
      const result=await sent.json();assert.equal(result.state,'published');assert.equal(result.delivered,2);assert.equal(result.undelivered,1);
      const replay=await request('/instructions/send',staff,{...post(payload),headers:auth});assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
      assert.equal((await request('/instructions/sends/'+payload.requestId,staff)).status,409);
      const status=await request('/instructions/sends/'+payload.requestId,staff,{headers:auth});assert.equal(status.status,200);assert.equal((await status.json()).publicationId,result.publicationId);

      const foreign=cookieOf(await request('/auth/staff/login',null,post({email:'other@example.test',password:'long-enough-password'})));
      const foreignContext=(await (await request('/session',foreign)).json()).clientContext;
      assert.equal((await request('/instructions/sends/'+payload.requestId,foreign,{headers:{'x-client-session-context':foreignContext}})).status,404);
      assert.equal((await request('/instructions/sends/'+payload.requestId+'/retry',foreign,{...post({requestId:randomUUID()}),headers:{'x-client-session-context':foreignContext}})).status,404);
      assert.equal((await request('/instructions/sends/'+payload.requestId+'/retry',staff,post({requestId:randomUUID()}))).status,409);
      assert.equal((await request('/instructions/sends/'+payload.requestId+'/retry?scope=x',staff,{...post({requestId:randomUUID()}),headers:auth})).status,400);
      assert.equal((await request('/instructions/sends/'+payload.requestId+'/retry',staff,{...post({requestId:'not-a-uuid'}),headers:auth})).status,400);
      assert.equal((await request('/instructions/sends/'+payload.requestId+'/retry',staff,{...post({}),headers:auth})).status,400);
      await db.query(`UPDATE briefings SET prepared_json=jsonb_set(prepared_json,'{languages,hi}',prepared_json->'languages'->'en') WHERE id=$1`,[payload.requestId]);
      const retryRequestId=randomUUID(),retried=await request('/instructions/sends/'+payload.requestId+'/retry',staff,{...post({requestId:retryRequestId}),headers:auth});
      assert.equal(retried.status,201);
      const retriedBody=await retried.json();
      assert.equal(retriedBody.retried,1);assert.equal(retriedBody.released,1);assert.equal(retriedBody.delivered,3);
      assert.equal(retriedBody.undelivered,0);assert.deepEqual(retriedBody.deliveryStates,{preparing:0,available:3,blocked:0,failed:0,withdrawn:0});
      assert.equal(retriedBody.publicationId,result.publicationId);assert.equal(retriedBody.retryable,false);
      const retryReplay=await request('/instructions/sends/'+payload.requestId+'/retry',staff,{...post({requestId:retryRequestId}),headers:auth});
      assert.equal(retryReplay.status,200);assert.equal((await retryReplay.json()).duplicate,true);
      assert.equal((await db.query('SELECT COUNT(*)::int n FROM instruction_retries WHERE send_request_id=$1',[payload.requestId])).rows[0].n,1);
      const afterRetry=await (await request('/instructions/sends/'+payload.requestId,staff,{headers:auth})).json();
      assert.equal(afterRetry.delivered,3);assert.equal(afterRetry.undelivered,0);assert.equal(afterRetry.retryable,false);

      const grant=await issueWorkerGrant(pool,owner,'w1',30,scope);
      const member=cookieOf(await request('/auth/worker/redeem',null,post({token:grant.token,company:'a',workerId:'001',password:'Assigned synthetic worker password'})));
      const workerContext=(await (await request('/session',member)).json()).clientContext;
      assert.equal((await request('/instructions/send',member,{...post({...payload,requestId:randomUUID()}),headers:{'x-client-session-context':workerContext}})).status,403);
      assert.equal((await request('/instructions/audience',member,{headers:{'x-client-session-context':workerContext}})).status,403);
      const inbox=await (await request('/worker/briefings',member)).json();
      const item=inbox.items.find(value=>value.publicationId===result.publicationId);
      assert.ok(item);assert.equal(item.responseMode,'acknowledge');assert.equal(item.deliveryMode,'text');
      const detail=await (await request('/worker/briefings/'+item.id,member)).json();
      assert.equal(detail.responseMode,'acknowledge');assert.equal(detail.content.question,undefined);assert.equal(detail.content.speech,null);
      const missing=await request('/worker/briefings/'+item.id+'/acknowledge',member,post({requestId:randomUUID()}));
      assert.equal(missing.status,409);assert.deepEqual(await missing.json(),{error:'Session context changed'});
      assert.equal((await request('/worker/briefings/'+item.id+'/acknowledge',member,{...post({requestId:'not-a-uuid'}),headers:{'x-client-session-context':workerContext}})).status,400);
      const answer=await request('/worker/briefings/'+item.id+'/answers',member,{...post({submissionId:randomUUID(),text:'Done.'}),headers:{'x-client-session-context':workerContext}});
      assert.equal(answer.status,400);assert.deepEqual(await answer.json(),{error:'This instruction only requires confirmation'});
      const ackRequest=randomUUID();
      const ack=await request('/worker/briefings/'+item.id+'/acknowledge',member,{...post({requestId:ackRequest}),headers:{'x-client-session-context':workerContext}});
      assert.equal(ack.status,201);assert.equal((await ack.json()).duplicate,false);
      const ackReplay=await request('/worker/briefings/'+item.id+'/acknowledge',member,{...post({requestId:ackRequest}),headers:{'x-client-session-context':workerContext}});
      assert.equal(ackReplay.status,200);assert.equal((await ackReplay.json()).duplicate,true);
      const receipt=await (await request('/worker/briefings/'+item.id+'/receipts/acknowledge/'+ackRequest,member)).json();
      assert.equal(receipt.id,ackRequest);assert.equal(receipt.status,'acknowledged');assert.equal(receipt.duplicate,true);
      assert.ok(receipt.receivedAt);
    });
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM publications WHERE briefing_id=$1',[httpRequestId])).rows[0].n,1);
  }finally{await db.close();}
});


test('PostgreSQL multiple-choice assessment uses the frozen key and routes incorrect answers to the supervisor',async()=>{
  const f=await fixture(),{db,pool}=f;
  try{
    const payload={...instruction(),responseMode:'question',deliveryMode:'text'};
    await startInstructionSend(pool,owner,payload,scope);await prepare(pool);
    const sent=await completeInstructionSend(pool,owner,payload.requestId,scope);
    const snapshot=(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[sent.publicationId])).rows[0].snapshot_json;
    const assignment=(await db.query("SELECT id FROM assignments WHERE publication_id=$1 AND worker_id='w1'",[sent.publicationId])).rows[0].id;
    const detail=await workerBriefing(pool,worker,assignment,scope);
    assert.equal(detail.content.questionType,'multiple-choice');assert.equal(detail.content.choices.length,4);
    assert.ok(!JSON.stringify(detail).includes('correctChoiceId'));
    await assert.rejects(submitAnswer(pool,worker,assignment,randomUUID(),'invented-choice',scope),/published choices/);
    const wrong=snapshot.languages.en.choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId).id;
    let providerCalls=0;const adapter={permitsAssessment:()=>false,assess:async()=>{providerCalls++;throw Error('A published choice does not need a provider guess');}};
    const first=await submitAnswer(pool,worker,assignment,randomUUID(),wrong,scope);
    assert.equal(await processOneAssessment(pool,adapter,scope),true);
    assert.equal((await db.query('SELECT outcome FROM attempts WHERE id=$1',[first.id])).rows[0].outcome,'clarification');
    assert.equal((await db.query('SELECT count(*)::int n FROM clarifications WHERE assignment_id=$1',[assignment])).rows[0].n,1);
    const second=await submitAnswer(pool,worker,assignment,randomUUID(),snapshot.rubric.correctChoiceId,scope);
    assert.equal(await processOneAssessment(pool,adapter,scope),true);
    assert.equal((await db.query('SELECT outcome FROM attempts WHERE id=$1',[second.id])).rows[0].outcome,'matched');
    assert.equal(providerCalls,0);
    const staff=await getPublicationResponse(pool,owner,sent.publicationId,assignment,{},scope);
    assert.equal(staff.questionType,'multiple-choice');assert.equal(staff.choices.length,4);
  }finally{await db.close();}
});

test('PostgreSQL sends expose every crew and reject selected workers whose language is still unassigned',async()=>{
  const f=await fixture();try{
    await f.db.query("INSERT INTO workers(id,org_id,site_id,code,language,language_selection_required) VALUES('new-worker','a','a','Pending','en',true)");
    const input=instruction();await assert.rejects(startInstructionSend(f.pool,owner,input,scope),/Choose a language/);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM instruction_sends WHERE request_id=$1',[input.requestId])).rows[0].n,0);
    for(let i=0;i<101;i++)await f.db.query("INSERT INTO crews(id,org_id,site_id,name) VALUES($1,'a','a',$2)",[`crew-${i}`,`Crew ${i}`]);
    const overview=await instructionAudienceOverview(f.pool,owner,scope);assert.equal(overview.crews.length,102);assert.equal(overview.workers.notSelected,1);
    await f.db.query("UPDATE workers SET language_selection_required=false WHERE id='new-worker'");
    assert.equal((await startInstructionSend(f.pool,owner,input,scope)).audience.count,4);
  }finally{await f.db.close();}
});
