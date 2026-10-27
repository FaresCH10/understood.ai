import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE,submitAnswer} from '../server/domain.mjs';
import {entitlementSummary} from '../server/entitlement-model.mjs';
import {ensureEntitlementSchema,entitlementState,requireWritableEntitlement} from '../server/entitlements.mjs';
import {startInstructionSend,completeInstructionSend,retryInstructionSend} from '../server/instructions.mjs';
import {startInstructionSend as startPgInstructionSend,completeInstructionSend as completePgInstructionSend,
  retryInstructionSend as retryPgInstructionSend} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {submitAnswer as submitPgAnswer} from '../server/postgres/domain.mjs';
import {acknowledgeAssignment,ensureAcknowledgementSchema} from '../server/acknowledgments.mjs';
import {acknowledgeAssignment as acknowledgePgAssignment} from '../server/postgres/acknowledgments.mjs';
import {requestHelp} from '../server/clarifications.mjs';
import {sendCaseMessage,ensureCaseMessageSchema} from '../server/case-messages.mjs';
import {createWorker} from '../server/people.mjs';
import {ensureWorkerImportSchema,previewWorkerImport,confirmWorkerImport} from '../server/worker-import.mjs';
import {createSchedule,processOneSchedule} from '../server/schedules.mjs';
import {receiveRecording} from '../server/recordings.mjs';
import {processOne} from '../server/worker.mjs';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';

const owner={principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'};
const worker={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut',access_mode:'demo'};
const sendInput=(requestId,extra={})=>({requestId,title:'Ladder move',source:CANONICAL_SOURCE,
  audience:{type:'all'},responseMode:'question',deliveryMode:'both',...extra});

function putEntitlement(db,{state='active',endsAt=null,workerLimit=25}={}){
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO organization_entitlements VALUES('cedar',?,?,?,?,'synthetic',NULL,1,'synthetic-test',?)`)
    .run(state,now,endsAt,workerLimit,now);
  db.prepare(`INSERT INTO organization_entitlement_transitions
    SELECT org_id,revision,state,started_at,ends_at,worker_limit,plan,terms_reference,'Synthetic setup','system','synthetic-test',NULL,?
    FROM organization_entitlements WHERE org_id='cedar'`).run(now);
}

function moveEntitlement(db,state,{endsAt=null}={}){
  const now=new Date().toISOString();
  db.prepare(`UPDATE organization_entitlements SET state=?,ends_at=?,revision=revision+1,
    updated_by='synthetic-test',updated_at=? WHERE org_id='cedar'`).run(state,endsAt,now);
  db.prepare(`INSERT INTO organization_entitlement_transitions
    SELECT org_id,revision,state,started_at,ends_at,worker_limit,plan,terms_reference,'Synthetic transition','system','synthetic-test',NULL,?
    FROM organization_entitlements WHERE org_id='cedar'`).run(now);
}

function assignmentId(db,publicationId){
  return db.prepare("SELECT id FROM assignments WHERE publication_id=? AND worker_id='worker-1'").get(publicationId).id;
}

function publish(db,input){
  const started=startInstructionSend(db,owner,input);
  assert.equal(started.state,'preparing');
  assert.equal(processOne(db),true);
  return completeInstructionSend(db,owner,input.requestId);
}

test('entitlement summaries treat no row as unmanaged and expire at the exact boundary',()=>{
  assert.deepEqual(entitlementSummary(null),{configured:false,state:'unmanaged',effectiveState:'unmanaged',writeAllowed:true,
    startedAt:null,endsAt:null,daysRemaining:null,workerLimit:null,plan:null,termsReference:null,revision:0});
  const start='2026-10-01T00:00:00.000Z',end='2026-10-15T00:00:00.000Z';
  const trial={state:'trial',started_at:start,ends_at:end,worker_limit:25,plan:'trial',terms_reference:'terms-v1',revision:1};
  const before=entitlementSummary(trial,{now:Date.parse('2026-10-14T23:59:59.999Z')});
  assert.equal(before.effectiveState,'trial');assert.equal(before.writeAllowed,true);assert.equal(before.daysRemaining,1);
  const boundary=entitlementSummary(trial,{now:Date.parse(end)});
  assert.equal(boundary.effectiveState,'read_only');assert.equal(boundary.writeAllowed,false);assert.equal(boundary.daysRemaining,0);
  assert.equal(entitlementSummary({...trial,state:'read_only',ends_at:null},{now:Date.parse(start)}).writeAllowed,false);
  assert.equal(entitlementSummary({...trial,state:'active',ends_at:null},{now:Date.parse(start)}).writeAllowed,true);
});

test('SQLite entitlement schema enforces revision, immutable history, one pending activation request and staff scope',()=>{
  const db=openDatabase(':memory:');seed(db);
  try {
    ensureEntitlementSchema(db);ensureEntitlementSchema(db);
    putEntitlement(db);
    assert.equal(requireWritableEntitlement(db,'cedar').state,'active');
    assert.throws(()=>db.prepare("UPDATE organization_entitlements SET revision=3 WHERE org_id='cedar'").run(),/revision conflict/i);
    assert.throws(()=>db.prepare(`INSERT INTO organization_entitlements VALUES('harbor','active',?,NULL,25,'synthetic',NULL,2,'synthetic-test',?)`)
      .run(new Date().toISOString(),new Date().toISOString()),/revision conflict/i);
    assert.throws(()=>db.prepare("DELETE FROM organization_entitlements WHERE org_id='cedar'").run(),/immutable/i);
    assert.throws(()=>db.prepare(`INSERT INTO organization_entitlement_transitions
      VALUES('cedar',2,'read_only','2026-10-01T00:00:00.000Z',NULL,25,'synthetic',NULL,'Mismatch','system','test',NULL,'2026-10-01T00:00:00.000Z')`).run(),
      /scope mismatch/i);
    assert.throws(()=>db.prepare("UPDATE organization_entitlement_transitions SET reason='changed' WHERE org_id='cedar' AND revision=1").run(),/immutable/i);
    assert.throws(()=>db.prepare("DELETE FROM organization_entitlement_transitions WHERE org_id='cedar' AND revision=1").run(),/immutable/i);
    const requestId=randomUUID(),created=new Date().toISOString();
    db.prepare(`INSERT INTO organization_activation_requests VALUES(?,?,?,?,?,1,'pending',?,NULL,NULL,NULL)`)
      .run(requestId,'cedar','beirut','maya','Please activate',created);
    assert.throws(()=>db.prepare(`INSERT INTO organization_activation_requests VALUES(?,?,?,?,?,1,'pending',?,NULL,NULL,NULL)`)
      .run(randomUUID(),'cedar','beirut','maya','Duplicate',created),/UNIQUE/i);
    assert.throws(()=>db.prepare(`INSERT INTO organization_activation_requests VALUES(?,?,?,?,?,1,'pending',?,NULL,NULL,NULL)`)
      .run(randomUUID(),'cedar','harbor-yard','maya','Wrong site',created),/scope mismatch/i);
    assert.throws(()=>db.prepare("UPDATE organization_activation_requests SET state='accepted' WHERE request_id=?").run(requestId),/closed/i);
    assert.throws(()=>db.prepare("DELETE FROM organization_activation_requests WHERE request_id=?").run(requestId),/immutable/i);
    assert.equal(entitlementState(db,'cedar').request.id,requestId);
    assert.equal(entitlementState(db,'cedar').request.state,'pending');
  } finally {db.close();}
});

test('trial expiry is read-only on the server clock and manual read-only blocks every write surface while replaying receipts',async()=>{
  const db=openDatabase(':memory:');seed(db);ensureAcknowledgementSchema(db);ensureCaseMessageSchema(db);ensureWorkerImportSchema(db);
  try {
    putEntitlement(db,{workerLimit:40});
    const questionId=randomUUID(),question=publish(db,sendInput(questionId));
    const ackId=randomUUID(),acknowledgement=publish(db,sendInput(ackId,{title:'Gate notice',responseMode:'acknowledge',deliveryMode:'text'}));
    const ack2Id=randomUUID(),acknowledgement2=publish(db,sendInput(ack2Id,{title:'Second notice',responseMode:'acknowledge',deliveryMode:'text'}));
    const preparingId=randomUUID(),preparing=startInstructionSend(db,owner,sendInput(preparingId));
    assert.equal(processOne(db),true);
    assert.equal(preparing.state,'preparing');

    const questionAssignment=assignmentId(db,question.publicationId),ackAssignment=assignmentId(db,acknowledgement.publicationId),
      ackAssignment2=assignmentId(db,acknowledgement2.publicationId);
    const choice=JSON.parse(db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get(question.publicationId).snapshot_json).rubric.correctChoiceId;
    const answerSubmission=randomUUID(),answer=submitAnswer(db,worker,questionAssignment,answerSubmission,choice);
    assert.equal(answer.duplicate,false);
    const ackRequest=randomUUID(),ack=acknowledgeAssignment(db,worker,ackAssignment,ackRequest);
    assert.equal(ack.duplicate,false);
    const helpRequest=randomUUID(),help=requestHelp(db,worker,questionAssignment,{requestId:helpRequest,text:'Which bay exactly?'});
    assert.equal(help.duplicate,false);
    const messageRequest=randomUUID(),message=sendCaseMessage(db,owner,help.id,{requestId:messageRequest,text:'Use the north bay.'});
    assert.equal(message.id,messageRequest);

    moveEntitlement(db,'read_only');
    assert.equal(entitlementState(db,'cedar').effectiveState,'read_only');
    const replayedAnswer=submitAnswer(db,worker,questionAssignment,answerSubmission,choice);
    assert.equal(replayedAnswer.duplicate,true);assert.equal(replayedAnswer.id,answer.id);
    assert.equal(acknowledgeAssignment(db,worker,ackAssignment,ackRequest).duplicate,true);
    assert.equal(requestHelp(db,worker,questionAssignment,{requestId:helpRequest,text:'Which bay exactly?'}).duplicate,true);
    assert.equal(sendCaseMessage(db,owner,help.id,{requestId:messageRequest,text:'Use the north bay.'}).id,messageRequest);
    assert.equal(startInstructionSend(db,owner,sendInput(questionId)).duplicate,true);

    assert.throws(()=>startInstructionSend(db,owner,sendInput(randomUUID())),/Workspace is read-only/);
    assert.throws(()=>submitAnswer(db,worker,questionAssignment,randomUUID(),'A different answer'),/Workspace is read-only/);
    assert.throws(()=>acknowledgeAssignment(db,worker,ackAssignment2,randomUUID()),/Workspace is read-only/);
    assert.throws(()=>requestHelp(db,worker,questionAssignment,{requestId:randomUUID(),text:'Another question'}),/Workspace is read-only/);
    assert.throws(()=>sendCaseMessage(db,owner,help.id,{requestId:randomUUID(),text:'Another reply'}),/Workspace is read-only/);
    await assert.rejects(receiveRecording(db,worker,questionAssignment,randomUUID(),Buffer.alloc(44)),/Workspace is read-only/);
    assert.throws(()=>createWorker(db,owner,{code:'Worker 099',language:'en'}),/Workspace is read-only/);
    const settled=completeInstructionSend(db,owner,preparingId);
    assert.equal(settled.state,'failed');assert.match(settled.error,/read-only/i);
    assert.equal(settled.retryable,true);

    const blocked=db.prepare("SELECT state,reason FROM instruction_deliveries WHERE request_id=? LIMIT 1").get(preparingId);
    assert.equal(blocked.state,'blocked');assert.equal(blocked.reason,'workspace_read_only');
    const failed=db.prepare('SELECT state,error,publication_id FROM instruction_sends WHERE request_id=?').get(preparingId);
    assert.equal(failed.state,'failed');assert.match(failed.error,/read-only/i);
    assert.equal(failed.publication_id,null);

    const preview=previewWorkerImport(db,owner,{requestId:randomUUID(),filename:'workers.csv',bytes:Buffer.from('worker_id,language\nNEW-1,en\n')});
    assert.equal(preview.status,'validated');
    assert.throws(()=>confirmWorkerImport(db,owner,preview.id),/Workspace is read-only/);
    assert.throws(()=>createSchedule(db,owner,'shelf',{requestId:randomUUID(),revision:1,nextVersion:4,
      workerIds:['worker-1'],dueAt:null,publishAt:new Date(Date.now()+3600000).toISOString()}),/Workspace is read-only/);
    const scheduledId=randomUUID(),now=new Date().toISOString();
    db.prepare(`INSERT INTO publication_schedules(id,org_id,site_id,briefing_id,request_json,snapshot_hash,recipients_json,
      requested_by,authority_json,publish_at,created_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued')`)
      .run(scheduledId,'cedar','beirut','shelf','{}','hash','[]','maya','{}',now,now);
    assert.equal(processOneSchedule(db),false);
    assert.equal(db.prepare('SELECT state FROM publication_schedules WHERE id=?').get(scheduledId).state,'queued');

    moveEntitlement(db,'active');
    assert.equal(confirmWorkerImport(db,owner,preview.id).status,'imported');
    const retried=retryInstructionSend(db,owner,preparingId,{requestId:randomUUID()});
    assert.equal(retried.state,'published');
    assert.equal(retried.delivered,30);
    moveEntitlement(db,'read_only');
    assert.equal(confirmWorkerImport(db,owner,preview.id).duplicate,true);
  } finally {db.close();}
});

test('PostgreSQL entitlement parity blocks new writes, settles a preparing send and replays receipts after activation',async()=>{
  const db=new PGlite(),pool={async connect(){return {async query(sql,values){return values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};}};
  const schema='understood_test_entitlements',options={schema,integrationMode:'synthetic'};
  const pgOwner={...owner,org_id:'a',site_id:'a',principal_id:'owner'};
  const pgWorker={...worker,org_id:'a',site_id:'a',principal_id:'w1'};
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.query("INSERT INTO organizations(id,name) VALUES('a','A')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role,active) VALUES('owner','a','a','Owner','owner',true)");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language,name) VALUES('w1','a','a','001','en','Worker One')");
  const now=new Date().toISOString();
  await db.query(`INSERT INTO organization_entitlements VALUES('a','active',$1,NULL,25,'synthetic',NULL,1,'synthetic-test',$1)`,[now]);
  await db.query(`INSERT INTO organization_entitlement_transitions
    SELECT org_id,revision,state,started_at,ends_at,worker_limit,plan,terms_reference,'Synthetic setup','system','synthetic-test',NULL,$1
    FROM organization_entitlements WHERE org_id='a'`,[now]);
  const lock=async state=>{
    const at=new Date().toISOString();
    await db.query("UPDATE organization_entitlements SET state=$1,ends_at=NULL,revision=revision+1,updated_by='synthetic-test',updated_at=$2 WHERE org_id='a'",[state,at]);
    await db.query(`INSERT INTO organization_entitlement_transitions
      SELECT org_id,revision,state,started_at,ends_at,worker_limit,plan,terms_reference,'Synthetic transition','system','synthetic-test',NULL,$1
      FROM organization_entitlements WHERE org_id='a'`,[at]);
  };
  try {
    const ackInput={requestId:randomUUID(),title:'Gate notice',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'acknowledge',deliveryMode:'text'};
    await startPgInstructionSend(pool,pgOwner,ackInput,options);
    assert.equal(await processOnePreparation(pool,options),true);
    const ackPublished=await completePgInstructionSend(pool,pgOwner,ackInput.requestId,options);
    const ackAssignment=(await db.query("SELECT id FROM assignments WHERE publication_id=$1 AND worker_id='w1'",[ackPublished.publicationId])).rows[0].id;

    const ack2Input={requestId:randomUUID(),title:'Second notice',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'acknowledge',deliveryMode:'text'};
    await startPgInstructionSend(pool,pgOwner,ack2Input,options);
    assert.equal(await processOnePreparation(pool,options),true);
    const ack2Published=await completePgInstructionSend(pool,pgOwner,ack2Input.requestId,options);
    const ack2Assignment=(await db.query("SELECT id FROM assignments WHERE publication_id=$1 AND worker_id='w1'",[ack2Published.publicationId])).rows[0].id;

    const questionInput={requestId:randomUUID(),title:'Ladder move',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'question',deliveryMode:'both'};
    await startPgInstructionSend(pool,pgOwner,questionInput,options);
    assert.equal(await processOnePreparation(pool,options),true);
    const question=await completePgInstructionSend(pool,pgOwner,questionInput.requestId,options);
    const questionAssignment=(await db.query("SELECT id FROM assignments WHERE publication_id=$1 AND worker_id='w1'",[question.publicationId])).rows[0].id;
    const submission=randomUUID();
    await submitPgAnswer(pool,pgWorker,questionAssignment,submission,(await db.query('SELECT snapshot_json FROM publications WHERE id=$1',[question.publicationId])).rows[0].snapshot_json.rubric.correctChoiceId,options);
    const ackRequest=randomUUID();
    await acknowledgePgAssignment(pool,pgWorker,ackAssignment,ackRequest,options);

    const preparingInput={requestId:randomUUID(),title:'Shelf handover',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'question',deliveryMode:'both'};
    const preparing=await startPgInstructionSend(pool,pgOwner,preparingInput,options);
    assert.equal(preparing.state,'preparing');
    assert.equal(await processOnePreparation(pool,options),true);
    await lock('read_only');
    assert.equal((await startPgInstructionSend(pool,pgOwner,questionInput,options)).duplicate,true);
    await assert.rejects(startPgInstructionSend(pool,pgOwner,{...questionInput,requestId:randomUUID()},options),/Workspace is read-only/);
    await assert.rejects(submitPgAnswer(pool,pgWorker,questionAssignment,randomUUID(),'Another answer',options),/Workspace is read-only/);
    assert.equal((await acknowledgePgAssignment(pool,pgWorker,ackAssignment,ackRequest,options)).duplicate,true);
    await assert.rejects(acknowledgePgAssignment(pool,pgWorker,ack2Assignment,randomUUID(),options),/Workspace is read-only/);
    const settled=await completePgInstructionSend(pool,pgOwner,preparing.requestId,options);
    assert.equal(settled.state,'failed');assert.match(settled.error,/read-only/i);
    assert.equal(settled.undeliveredReasons[0].reason,'workspace_read_only');
    await lock('active');
    const retried=await retryPgInstructionSend(pool,pgOwner,preparing.requestId,{requestId:randomUUID()},options);
    assert.equal(retried.retried,1);
    assert.equal(retried.state,'published');
    assert.equal(retried.delivered,1);
  } finally {await db.close();}
});
