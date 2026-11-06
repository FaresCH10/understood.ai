import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensurePeopleSchema,createCrew,moveWorkerToCrew} from '../server/people.mjs';
import {ensureReportAudienceSchema} from '../server/report-scope.mjs';
import {sqliteWorkspace} from '../server/workspace-sqlite.mjs';
import {workerCrewText} from '../src/worker-crew-text.ts';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},worker={principal_type:'worker',principal_id:'worker-1',org_id:'cedar',site_id:'beirut'};
test('worker crew is current, scoped, private and paginated; assignment audience remains frozen',async()=>{
 const db=openDatabase(':memory:');try{seed(db);ensurePeopleSchema(db);ensureReportAudienceSchema(db);
  assert.equal((await sqliteWorkspace(db,worker,'worker-crew')).crew,null);
  const crew=createCrew(db,staff,{name:'Morning crew'}),other=createCrew(db,staff,{name:'Evening crew'});
  moveWorkerToCrew(db,staff,'worker-1',crew.id);moveWorkerToCrew(db,staff,'worker-2',crew.id);moveWorkerToCrew(db,staff,'worker-3',other.id);
  let value=await sqliteWorkspace(db,worker,'worker-crew');assert.equal(value.crew.name,'Morning crew');assert.equal(value.crew.activeMembers,2);assert.equal(value.members.items[0].isYou,true);assert.equal(value.work.total,0);
  for(const member of value.members.items){assert.deepEqual(Object.keys(member).sort(),['isYou','language','name']);assert.ok(!JSON.stringify(member).includes('password'));}
  // Explicit frozen report audience, unrelated assignments must never be returned.
  db.prepare("INSERT INTO publication_report_audience(assignment_id,org_id,site_id,publication_id,crew_id,crew_name) VALUES('assignment-1','cedar','beirut','shelf-v3',?,?)").run(crew.id,crew.name);
  value=await sqliteWorkspace(db,worker,'worker-crew');assert.equal(value.work.total,1);assert.equal(value.work.items[0].id,'assignment-1');
  moveWorkerToCrew(db,staff,'worker-1',other.id);value=await sqliteWorkspace(db,worker,'worker-crew');assert.equal(value.crew.id,other.id);assert.equal(value.work.total,0);assert.equal(value.members.items.length,2);
  await assert.rejects(sqliteWorkspace(db,staff,'worker-crew'),/Forbidden/);await assert.rejects(sqliteWorkspace(db,worker,'worker-crew',{crewId:crew.id}),/Invalid crew request/);
  for(const input of [{page:0},{membersPage:5001},{status:'other'},{workerId:'worker-2'}])await assert.rejects(sqliteWorkspace(db,worker,'worker-crew',input),/Invalid crew request/);
  db.prepare('UPDATE crews SET active=0 WHERE id=?').run(other.id);assert.equal((await sqliteWorkspace(db,worker,'worker-crew')).crew,null);
 }finally{db.close();}
});
test('crew tab labels cover all worker languages',()=>{const keys=Object.keys(workerCrewText('en')).sort();for(const language of WORKER_LANGUAGE_CODES){const value=workerCrewText(language);assert.deepEqual(Object.keys(value).sort(),keys);for(const text of Object.values(value))assert.ok(text.trim().length>0);}});
