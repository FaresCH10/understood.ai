import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clarificationFixture} from './helpers/clarification-flow-fixture.mjs';
import {listClarificationFlow} from '../server/postgres/clarification-flow.mjs';
import {clarificationDay,clarificationDateAt,shiftClarificationDay} from '../server/clarification-day.mjs';
const owner={principal_type:'staff',principal_id:'owner',org_id:'org',site_id:'site',role:'owner'};
test('clarification dates are calendar dates and follow local midnight through DST',()=>{
 for(const bad of ['2026-02-30','2026-13-01','2025-01-02T00:00:00Z','',{},'2026-2-3'])assert.throws(()=>clarificationDay(bad),/Invalid/);
 assert.equal(shiftClarificationDay('2024-03-01',-1),'2024-02-29');
 assert.equal(clarificationDateAt('2026-11-17T22:00:00Z','Asia/Beirut'),'2026-11-18');
 assert.equal(clarificationDateAt('2026-03-08T04:59:59Z','America/New_York'),'2026-03-07');
 assert.equal(clarificationDateAt('2026-03-08T05:00:00Z','America/New_York'),'2026-03-08');
});
test('daily clarification view hides old requests, retains resolved and superseded cases, and includes new worker follow-ups in site time',async()=>{
 const f=await clarificationFixture();try{
  await f.db.exec("UPDATE sites SET timezone='Asia/Beirut';INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status,created_at) VALUES('dated-case','org','site','assignment',NULL,'help','open','2025-01-01T21:59:59Z')");
  const list=day=>listClarificationFlow(f.pool,owner,1,{day});
  assert.equal((await list('2025-01-01')).total,1);assert.equal((await list('2025-01-02')).total,0);
  await f.db.query(`INSERT INTO clarification_exchanges(id,org_id,site_id,case_id,assignment_id,attempt_id,kind,actor_id,source_language,target_language,source_text,request_hash,created_at)
   SELECT $1,org_id,site_id,'dated-case',assignment_id,attempt_id,'request','worker','ar','en','أي رف أستخدم؟','fixture-hash','2025-01-01T22:00:00Z' FROM clarifications WHERE id=$2`,[randomUUID(),f.caseId]);
  assert.equal((await list('2025-01-02')).total,1);assert.equal((await list('2025-01-03')).total,0);
  await f.db.exec("UPDATE clarifications SET status='resolved'");assert.equal((await list('2025-01-01')).total,1);assert.equal((await list('2025-01-02')).total,1);
  await f.db.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status,created_at) SELECT 'later-case',org_id,site_id,assignment_id,NULL,'help','open','2025-01-03T10:00:00Z' FROM clarifications WHERE id=$1`,[f.caseId]);
  assert.equal((await list('2025-01-01')).rows[0].id,'dated-case');assert.equal((await list('2025-01-03')).rows[0].id,'later-case');
  assert.equal((await listClarificationFlow(f.pool,owner,1,{day:'2025-01-02',briefingId:'another-instruction'})).total,0);
  await assert.rejects(async()=>list('2026-02-30'),/Invalid/);
  await assert.rejects(listClarificationFlow(f.pool,{...owner,site_id:'other-site'},1,{day:'2025-01-02'}),/Forbidden/);
 }finally{await f.db.close();}
});


test('SQLite daily view uses the same site-local dates and preserves prior resolved requests',async()=>{
 const {openDatabase,NOW}=await import('../server/db.mjs'),{sqliteApp}=await import('./helpers/sqlite-app.mjs');
 const {syntheticPrepare,CANONICAL_SOURCE,submitAnswer}=await import('../server/domain.mjs'),{withMultipleChoice}=await import('../server/multiple-choice.mjs');
 const {listClarificationFlow}=await import('../server/clarification-flow.mjs');
 const db=openDatabase(':memory:');sqliteApp(db);try{
  const snapshot=withMultipleChoice(syntheticPrepare(CANONICAL_SOURCE));
  db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run('day-publication','cedar','beirut','shelf',4,JSON.stringify(snapshot),NOW(),'published');
  db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language,created_at) VALUES(?,?,?,?,?,?,?)').run('day-assignment','cedar','beirut','day-publication','worker-14','ar',NOW());
  const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
  submitAnswer(db,{principal_type:'worker',principal_id:'worker-14',org_id:'cedar',site_id:'beirut'},'day-assignment',randomUUID(),snapshot.languages.ar.choices.find(choice=>choice.id!==snapshot.rubric.correctChoiceId).id);
  db.prepare("UPDATE sites SET timezone='Asia/Beirut' WHERE id='beirut'").run();
  for(const [id,date] of [['before-midnight','2025-01-01T21:59:59Z'],['after-midnight','2025-01-01T22:00:00Z']])db.prepare("INSERT INTO clarifications(id,org_id,assignment_id,attempt_id,reason,status,created_at) VALUES(?,'cedar','day-assignment',NULL,'help','resolved',?)").run(id,date);
  assert.deepEqual(listClarificationFlow(db,staff,1,{day:'2025-01-01'}).rows.map(row=>row.id),['before-midnight']);
  assert.deepEqual(listClarificationFlow(db,staff,1,{day:'2025-01-02'}).rows.map(row=>row.id),['after-midnight']);
  assert.equal(listClarificationFlow(db,staff,1,{day:'2025-01-03'}).total,0);
  const done=listClarificationFlow(db,staff,1,{day:'2025-01-01',section:'done'});assert.equal(done.total,1);assert.equal(done.done,1);assert.equal(done.unread,0);
  assert.equal(listClarificationFlow(db,staff,1,{day:'2025-01-01',section:'unread'}).total,0);
  assert.equal(listClarificationFlow(db,staff,1,{summaryOnly:true}).unreadInstructions,1);
  db.prepare("UPDATE clarifications SET status='resolved'").run();assert.equal(listClarificationFlow(db,staff,1,{summaryOnly:true}).unreadInstructions,0);
  assert.throws(()=>listClarificationFlow(db,staff,1,{section:'invalid'}),/Invalid clarification filter/);
  assert.throws(()=>listClarificationFlow(db,staff,1,{day:'2026-02-30'}),/Invalid/);
 }finally{db.close();}
});
