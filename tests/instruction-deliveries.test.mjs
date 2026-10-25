import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {
  startInstructionSend,completeInstructionSend,instructionSendStatus,
  retryInstructionSend,processOneInstructionSend,instructionDeliveryContentForAssignment,
} from '../server/instructions.mjs';
import {processOne} from '../server/worker.mjs';
import {workerBriefings} from '../server/responses.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {ensureAcknowledgementSchema} from '../server/acknowledgments.mjs';

const staffSession=()=>({principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'});
const workerSession=(id)=>({principal_type:'worker',principal_id:id,org_id:'cedar',site_id:'beirut',access_mode:'demo'});
const baseInput=(requestId,extra={})=>({requestId,title:'Ladder move',source:CANONICAL_SOURCE,
  audience:{type:'all'},responseMode:'question',deliveryMode:'both',...extra});

function prepared(db,briefingId) {
  return JSON.parse(db.prepare('SELECT prepared_json FROM briefings WHERE id=?').get(briefingId).prepared_json);
}

test('a late-prepared language rejoins the original publication without a second publication',()=>{
  const db=openDatabase(':memory:');seed(db);
  const session=staffSession();
  try {
    const requestId=randomUUID();
    const started=startInstructionSend(db,session,baseInput(requestId));
    assert.equal(started.state,'preparing');
    assert.equal(processOne(db),true);
    const full=prepared(db,requestId);
    assert.deepEqual(Object.keys(full.languages).sort(),['ar','en','ur']);
    db.prepare("UPDATE briefings SET prepared_json=json_remove(prepared_json,'$.languages.ar') WHERE id=?").run(requestId);

    const first=completeInstructionSend(db,session,requestId);
    assert.equal(first.state,'published');
    assert.equal(first.delivered,20);
    assert.equal(first.undelivered,10);
    assert.deepEqual(first.deliveryStates,{preparing:0,available:20,blocked:0,failed:10,withdrawn:0});
    assert.deepEqual(first.undeliveredReasons,[{reason:'language_unavailable',language:'ar',count:10}]);
    assert.equal(db.prepare('SELECT count(*) n FROM publications WHERE briefing_id=?').get(requestId).n,1);
    const publicationId=first.publicationId;
    assert.equal(db.prepare('SELECT count(*) n FROM assignments WHERE publication_id=?').get(publicationId).n,20);
    assert.equal(first.retryable,true);

    const retryRequestId=randomUUID();
    const retried=retryInstructionSend(db,session,requestId,{requestId:retryRequestId});
    assert.equal(retried.retried,10);
    assert.equal(retried.released,0);
    assert.equal(retried.state,'published');
    assert.equal(retried.publicationId,publicationId);
    assert.equal(retried.deliveryStates.preparing,10);
    assert.equal(db.prepare("SELECT state FROM briefings WHERE id=?").get(requestId).state,'processing');

    assert.equal(processOne(db),true);
    assert.equal(prepared(db,requestId).languages.ar.title.length>0,true);
    assert.equal(processOneInstructionSend(db),true);

    const complete=instructionSendStatus(db,session,requestId);
    assert.equal(complete.state,'published');
    assert.equal(complete.publicationId,publicationId);
    assert.equal(complete.delivered,30);
    assert.equal(complete.undelivered,0);
    assert.deepEqual(complete.undeliveredReasons,[]);
    assert.deepEqual(complete.deliveryStates,{preparing:0,available:30,blocked:0,failed:0,withdrawn:0});
    assert.equal(db.prepare('SELECT count(*) n FROM publications WHERE briefing_id=?').get(requestId).n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM assignments WHERE publication_id=?').get(publicationId).n,30);
    assert.equal(db.prepare('SELECT count(*) n FROM publication_report_audience WHERE publication_id=?').get(publicationId).n,30);
    assert.equal(db.prepare("SELECT count(*) n FROM instruction_deliveries WHERE request_id=? AND language='ar' AND state='available' AND content_json IS NOT NULL AND assignment_id IS NOT NULL").get(requestId).n,10);

    const replay=retryInstructionSend(db,session,requestId,{requestId:retryRequestId});
    assert.equal(replay.duplicate,true);
    assert.equal(replay.retried,10);
    assert.equal(replay.released,0);

    const arWorker=db.prepare("SELECT id FROM workers WHERE language='ar' AND active=1 ORDER BY code LIMIT 1").get();
    ensureRecordingSchema(db);ensureAcknowledgementSchema(db);
    const inbox=workerBriefings(db,workerSession(arWorker.id),{view:'todo'});
    const item=inbox.items.find((value)=>value.publicationId===publicationId);
    assert.ok(item);
    assert.equal(item.language,'ar');
    assert.ok(item.title.length>0);
    assert.notEqual(item.title,'Ladder move');
    const delivery=instructionDeliveryContentForAssignment(db,'cedar','beirut',arWorker.id,item.id);
    assert.equal(delivery.language,'ar');
    assert.ok(delivery.content.text.length>0);
  } finally {db.close();}
});

test('retries re-check workers, stay idempotent per receipt and stop after three attempts',()=>{
  const db=openDatabase(':memory:');seed(db);
  const session=staffSession();
  try {
    const requestId=randomUUID();
    startInstructionSend(db,session,baseInput(requestId));
    processOne(db);
    db.prepare("UPDATE workers SET active=0 WHERE id='worker-1'").run();
    const first=completeInstructionSend(db,session,requestId);
    assert.equal(first.delivered,29);
    assert.deepEqual(first.deliveryStates,{preparing:0,available:29,blocked:1,failed:0,withdrawn:0});
    assert.deepEqual(first.undeliveredReasons,[{reason:'worker_inactive',language:'en',count:1}]);

    const retryId=randomUUID();
    const blocked=retryInstructionSend(db,session,requestId,{requestId:retryId});
    assert.equal(blocked.retried,1);
    assert.equal(blocked.released,0);
    assert.equal(blocked.delivered,29);
    assert.deepEqual(blocked.undeliveredReasons,[{reason:'worker_inactive',language:'en',count:1}]);
    assert.equal(db.prepare('SELECT state FROM briefings WHERE id=?').get(requestId).state,'draft');
    const replay=retryInstructionSend(db,session,requestId,{requestId:retryId});
    assert.equal(replay.duplicate,true);
    assert.equal(replay.retried,1);
    assert.equal(replay.released,0);

    db.prepare("UPDATE workers SET active=1 WHERE id='worker-1'").run();
    const released=retryInstructionSend(db,session,requestId,{requestId:randomUUID()});
    assert.equal(released.retried,1);
    assert.equal(released.released,1);
    assert.equal(released.delivered,30);
    assert.equal(released.undelivered,0);
    assert.equal(db.prepare('SELECT count(*) n FROM publications WHERE briefing_id=?').get(requestId).n,1);
    assert.equal(db.prepare('SELECT attempts FROM instruction_deliveries WHERE request_id=? AND worker_id=?').get(requestId,'worker-1').attempts,2);
    const empty=retryInstructionSend(db,session,requestId,{requestId:randomUUID()});
    assert.equal(empty.retried,0);
    assert.equal(empty.retryable,false);

    const limitRequest=randomUUID();
    startInstructionSend(db,session,baseInput(limitRequest));
    processOne(db);
    db.prepare("UPDATE workers SET language='ar' WHERE id='worker-1'").run();
    const changed=completeInstructionSend(db,session,limitRequest);
    assert.equal(changed.delivered,29);
    assert.deepEqual(changed.undeliveredReasons,[{reason:'language_changed',language:'en',count:1}]);
    for(let attempt=1;attempt<=3;attempt+=1) {
      const result=retryInstructionSend(db,session,limitRequest,{requestId:randomUUID()});
      assert.equal(result.retried,1);
      assert.equal(result.released,0);
      assert.equal(db.prepare('SELECT attempts FROM instruction_deliveries WHERE request_id=? AND worker_id=?').get(limitRequest,'worker-1').attempts,attempt);
    }
    assert.throws(()=>retryInstructionSend(db,session,limitRequest,{requestId:randomUUID()}),/Instruction retry limit reached/);
    assert.equal(instructionSendStatus(db,session,limitRequest).retryable,false);
  } finally {db.close();}
});

test('a passed deadline blocks late release and leaves reminders for the delivered recipients',async()=>{
  const db=openDatabase(':memory:');seed(db);
  const session=staffSession();
  try {
    const requestId=randomUUID(),dueAt=new Date(Date.now()+2000).toISOString();
    startInstructionSend(db,session,baseInput(requestId,{dueAt,reminderMinutes:60}));
    processOne(db);
    db.prepare("UPDATE briefings SET prepared_json=json_remove(prepared_json,'$.languages.ar') WHERE id=?").run(requestId);
    const first=completeInstructionSend(db,session,requestId);
    assert.equal(first.delivered,20);
    assert.equal(first.dueAt,dueAt);
    assert.equal(first.reminderMinutes,60);
    assert.equal(db.prepare('SELECT count(*) n FROM assignment_reminders WHERE publication_id=?').get(first.publicationId).n,20);

    const retryId=randomUUID();
    const queued=retryInstructionSend(db,session,requestId,{requestId:retryId});
    assert.equal(queued.retried,10);
    assert.equal(queued.released,0);
    await new Promise((resolve)=>setTimeout(resolve,2100));
    assert.equal(processOne(db),true);
    processOneInstructionSend(db);
    const after=instructionSendStatus(db,session,requestId);
    assert.equal(after.state,'published');
    assert.equal(after.delivered,20);
    assert.equal(after.undelivered,10);
    assert.deepEqual(after.undeliveredReasons,[{reason:'deadline_passed',language:'ar',count:10}]);
    assert.equal(after.retryable,false);
    assert.throws(()=>retryInstructionSend(db,session,requestId,{requestId:randomUUID()}),/Instruction deadline passed/);
    assert.equal(db.prepare('SELECT count(*) n FROM assignment_reminders WHERE publication_id=?').get(first.publicationId).n,20);
  } finally {db.close();}
});
