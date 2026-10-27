import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE,syntheticPrepare,publish as localPublish} from '../server/domain.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {processOneReminder as localProcess} from '../server/reminders.mjs';
import {processOneReminder as pgProcess} from '../server/postgres/reminders.mjs';
import {workerBriefings as localInbox} from '../server/responses.mjs';
import {workerBriefings as pgInbox} from '../server/postgres/read-models.mjs';
import {publicationInput} from '../server/briefing-input.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {ensureDeletionSchema} from '../server/deletions.mjs';
import {createSchedule as localSchedule,processOneSchedule as localScheduleProcess} from '../server/schedules.mjs';
import {createSchedule as pgSchedule,processOneSchedule as pgScheduleProcess} from '../server/postgres/schedules.mjs';

const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'};
const worker=id=>({principal_type:'worker',principal_id:id,org_id:'a',site_id:'a'});
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_assignment_reminders';let clock=null,failQueue=false;
  const client={async query(sql,values){if(failQueue && sql.startsWith('INSERT INTO assignment_reminders'))throw Error('Private reminder failure');if(clock!==null)sql=sql.replaceAll('clock_timestamp()',`'${new Date(clock).toISOString()}'::timestamptz`);return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}},options={schema,integrationMode:'synthetic'};
  const exec=async(sql,values=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...values)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}else {seed(db);ensureRecordingSchema(db);ensureDeletionSchema(db);}
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner')");
  await exec("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','W1','en'),('w2','a','a','W2','ar'),('foreign','b','b','Foreign','en')");
  const brief=async id=>exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,'a','a','Shelf',CANONICAL_SOURCE,'ready',JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),new Date().toISOString(),new Date().toISOString()]);
  return {db,exec,brief,publish:(id,input)=>postgres?pgPublish(pool,owner,id,input,options):localPublish(db,owner,id,input),
    process:()=>postgres?pgProcess(pool,options):localProcess(db),inbox:s=>postgres?pgInbox(pool,s,options,{view:'todo'}):localInbox(db,s,{view:'todo'}),
    schedule:(id,input)=>postgres?pgSchedule(pool,owner,id,input,options):localSchedule(db,owner,id,input),
    processSchedule:()=>postgres?pgScheduleProcess(pool,options):localScheduleProcess(db),
    setClock:value=>{clock=value;},setFailQueue:value=>{failQueue=value;},close:()=>db.close()};
}
const input=(extra={})=>({requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w2','w1'],dueAt:new Date(Date.now()+600000).toISOString(),reminderMinutes:60,...extra});

test('deadline reminders are optional, explicit, bounded and require a zoned deadline',()=>{
  for(const extra of [{reminderMinutes:'60'},{reminderMinutes:30},{reminderMinutes:-1},{reminderMinutes:60,dueAt:null},{reminderMinutes:1.5},{email:true}])assert.throws(()=>publicationInput(input(extra)),/Invalid/);
  assert.ok(!('reminderMinutes' in publicationInput(input({reminderMinutes:0}))));
  assert.ok(!('reminderMinutes' in publicationInput(input({reminderMinutes:undefined}))));
  assert.equal(publicationInput(input({reminderMinutes:1440})).reminderMinutes,1440);
});
for(const postgres of [false,true]) {
  const name=postgres?'PostgreSQL':'SQLite';
  test(`${name} publication atomically queues optional frozen reminders; exact replay and worker visibility are bounded`,async()=>{
    const f=await fixture(postgres);
    try {
      await f.brief('brief');const request=input(),published=await f.publish('brief',request);
      assert.equal((await f.exec('SELECT count(*) n FROM assignment_reminders')).rows[0].n,2);
      assert.equal((await f.publish('brief',request)).duplicate,true);
      await assert.rejects(async()=>f.publish('brief',{...request,reminderMinutes:1440}),/conflict/);
      assert.ok(!(await f.inbox(worker('w1'))).items[0].reminderAt);
      while(await f.process()) {}
      const first=(await f.inbox(worker('w1'))).items[0];assert.ok(first.reminderAt);assert.equal(first.publicationId,published.id);
      await assert.rejects(async()=>f.inbox(worker('foreign')),/Forbidden/);
      assert.equal((await f.inbox({...worker('foreign'),org_id:'b',site_id:'b'})).items.length,0);
      const serialized=JSON.stringify(await f.inbox(worker('w1')));assert.doesNotMatch(serialized,/authority_json|requested_by|askedFacts|workerIds|reminderMinutes/);
      assert.equal(await f.process(),false);
      const assignment=(await f.exec("SELECT id FROM assignments WHERE publication_id=? AND worker_id='w1'",[published.id])).rows[0].id;
      await f.exec("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES('a',?,'received-audio-only','audio',?)",[assignment,new Date().toISOString()]);
      assert.equal((await f.inbox(worker('w1'))).items.length,0);
      await f.exec("UPDATE publications SET state='withdrawn' WHERE id=?",[published.id]);
      assert.equal((await f.inbox(worker('w2'))).items.length,0);
      await assert.rejects(async()=>f.exec("UPDATE assignment_reminders SET due_at=? WHERE assignment_id=?",[new Date().toISOString(),assignment]),/immutable/);
      await assert.rejects(async()=>f.exec('DELETE FROM assignment_reminders WHERE assignment_id=?',[assignment]),/immutable/);
      await f.brief('off');await f.publish('off',input({reminderMinutes:0}));assert.equal((await f.exec('SELECT count(*) n FROM assignment_reminders')).rows[0].n,2);
    }finally {await f.close();}
  });
  test(`${name} reminders suppress answered, disabled, expired, archived, replaced and authority-invalidated assignments`,async t=>{
    const f=await fixture(postgres),now=Date.now();t.mock.timers.enable({apis:['Date'],now});f.setClock(now);
    const advance=value=>{t.mock.timers.setTime(value);f.setClock(value);};
    try {
      for(const kind of ['answered','acknowledged','disabled','withdrawn','archived','superseded','authority','expired']) {
        await f.brief(kind);const published=await f.publish(kind,input({workerIds:['w1']}));
        const assignment=(await f.exec('SELECT id FROM assignments WHERE publication_id=?',[published.id])).rows[0].id;
        if(kind==='answered')await f.exec("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES('a',?,'received-typed-only','typed',?)",[assignment,new Date().toISOString()]);
        if(kind==='acknowledged')await f.exec("INSERT INTO acknowledgments(request_id,org_id,site_id,assignment_id,worker_id,received_at) VALUES(?,'a','a',?,'w1',?)",[randomUUID(),assignment,new Date().toISOString()]);
        if(kind==='disabled')await f.exec(`UPDATE workers SET active=${postgres?'false':'0'} WHERE id='w1'`);
        if(['withdrawn','superseded','archived'].includes(kind))await f.exec('UPDATE publications SET state=? WHERE id=?',[kind,published.id]);
        if(kind==='authority'){await f.exec("UPDATE staff SET role='supervisor' WHERE id='owner'");await f.exec("UPDATE staff SET role='owner' WHERE id='owner'");}
        if(kind==='expired')advance(now+1200000);
        assert.equal(await f.process(),true);
        assert.equal((await f.exec('SELECT state FROM assignment_reminders WHERE assignment_id=?',[assignment])).rows[0].state,'skipped');
        assert.equal(await f.process(),false);
        if(kind==='disabled')await f.exec(`UPDATE workers SET active=${postgres?'true':'1'} WHERE id='w1'`);
      }
    }finally {await f.close();}
  });
  test(`${name} scheduled publication preserves reminder intent and does not queue reminders before publication`,async t=>{
    const f=await fixture(postgres),now=Date.now();t.mock.timers.enable({apis:['Date'],now});f.setClock(now);
    try {
      await f.brief('scheduled');const request={...input(),nextVersion:1,publishAt:new Date(now+60000).toISOString()};
      const accepted=await f.schedule('scheduled',request);assert.equal(accepted.reminderMinutes,60);
      assert.equal((await f.exec('SELECT count(*) n FROM assignment_reminders')).rows[0].n,0);
      t.mock.timers.setTime(now+120000);f.setClock(now+120000);assert.equal(await f.processSchedule(),true);
      assert.equal((await f.exec('SELECT count(*) n FROM assignment_reminders')).rows[0].n,2);
      while(await f.process()) {}
      assert.ok((await f.inbox(worker('w1'))).items[0].reminderAt);
      assert.equal((await f.schedule('scheduled',request)).duplicate,true);
      assert.equal((await f.exec('SELECT count(*) n FROM assignment_reminders')).rows[0].n,2);
    }finally {await f.close();}
  });
}
test('PostgreSQL reminder insertion failure rolls back the publication and all assignments',async()=>{
  const f=await fixture(true);
  try {
    await f.brief('rollback');f.setFailQueue(true);await assert.rejects(()=>f.publish('rollback',input()),/Private reminder failure/);
    for(const table of ['publications','assignments','assignment_reminders'])assert.equal((await f.exec(`SELECT count(*) n FROM ${table}`)).rows[0].n,0);
  }finally {await f.close();}
});
