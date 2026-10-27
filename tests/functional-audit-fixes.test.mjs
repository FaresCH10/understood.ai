import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensurePeopleSchema} from '../server/people.mjs';
import {createDraft,queuePreparation} from '../server/preparation.mjs';
import {processOne} from '../server/worker.mjs';
import {startInstructionSend,instructionAudienceOverview} from '../server/instructions.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {processOneRecording} from '../server/recording-worker.mjs';
import {sweepOverdueAssignments} from '../server/notification-events.mjs';
const owner={org_id:'cedar',site_id:'beirut',principal_type:'staff',principal_id:'maya',role:'owner'};
const fixture=()=>{const db=openDatabase(':memory:');seed(db);ensurePeopleSchema(db);return db;};
test('all-worker sends reject incomplete language selection before creating a receipt, then deliver after selection',()=>{
  const db=fixture();try{
    db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,language_selection_required) VALUES('worker-new','cedar','beirut','New worker','en',1)").run();
    const input={requestId:randomUUID(),title:'Shelf handover',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'question',deliveryMode:'text'};
    assert.equal(instructionAudienceOverview(db,owner).workers.notSelected,1);
    assert.throws(()=>startInstructionSend(db,owner,input),/Choose a language/);
    assert.equal(db.prepare('SELECT count(*) n FROM instruction_sends WHERE request_id=?').get(input.requestId).n,0);
    db.prepare("UPDATE workers SET language_selection_required=0 WHERE id='worker-new'").run();
    assert.equal(startInstructionSend(db,owner,input).audience.count,31);
  }finally{db.close();}
});
test('the send audience includes crews beyond the previous 100-row cutoff',()=>{
  const db=fixture();try{
    for(let i=0;i<101;i++)db.prepare("INSERT INTO crews(id,org_id,site_id,name) VALUES(?,'cedar','beirut',?)").run(`crew-${i}`,`Crew ${i}`);
    assert.equal(instructionAudienceOverview(db,owner).crews.length,101);
  }finally{db.close();}
});
test('ordinary typed draft preparation requires multiple choice and retains the supervisor title',()=>{
  const db=fixture();try{
    const draft=createDraft(db,owner,{requestId:randomUUID(),title:'Supervisor chosen title',source:CANONICAL_SOURCE});
    queuePreparation(db,owner,draft.id,1);while(processOne(db)){}
    const row=db.prepare('SELECT state,prepared_json FROM briefings WHERE id=?').get(draft.id),prepared=JSON.parse(row.prepared_json);
    assert.equal(row.state,'ready');assert.equal(prepared.languages.en.title,'Supervisor chosen title');
    assert.equal(prepared.rubric.mode,'multiple-choice');assert.equal(prepared.languages.en.choices.length,4);
  }finally{db.close();}
});
test('local recording runtime reports missing processing instead of leaving accepted audio pending forever',async()=>{
  const db=fixture();try{
    ensureRecordingSchema(db);const id=randomUUID();
    db.prepare("INSERT INTO recordings(id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,created_at) VALUES(?,'cedar','beirut','assignment-30',?,'synthetic',1,32044,'received',?)").run(id,randomUUID(),new Date().toISOString());
    assert.equal(await processOneRecording(db,null),true);assert.equal(await processOneRecording(db,null),false);
    const row=db.prepare('SELECT * FROM recordings WHERE id=?').get(id);assert.equal(row.status,'blocked');assert.equal(row.transcript,null);assert.match(row.error,/unavailable/);
  }finally{db.close();}
});
test('overdue sweep excludes acknowledged assignments',()=>{
  const db=fixture();try{
    ensureRecordingSchema(db);db.prepare("INSERT INTO acknowledgments(request_id,org_id,site_id,assignment_id,worker_id,received_at) VALUES(?,'cedar','beirut','assignment-30','worker-30',?)").run(randomUUID(),new Date().toISOString());
    sweepOverdueAssignments(db,{now:'2099-01-01T00:00:00.000Z',force:true});
    assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE action='assignment.overdue' AND object_id='assignment-30'").get().n,0);
  }finally{db.close();}
});
