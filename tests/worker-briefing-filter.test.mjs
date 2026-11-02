import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE,syntheticPrepare,publish as localPublish} from '../server/domain.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {workerBriefings as localInbox,workerInboxFilters} from '../server/responses.mjs';
import {workerBriefings as pgInbox} from '../server/postgres/read-models.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {ensureDeletionSchema} from '../server/deletions.mjs';

const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'};
const worker=id=>({principal_type:'worker',principal_id:id,org_id:'a',site_id:'a'});

async function fixture(postgres){
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_worker_briefing_filter';
  const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}},options={schema,integrationMode:'synthetic'};
  const exec=async(sql,values=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...values)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}
  else {seed(db);ensureRecordingSchema(db);ensureDeletionSchema(db);}
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner')");
  await exec("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','W1','en'),('w2','a','a','W2','ar'),('foreign','b','b','Foreign','en')");
  const brief=id=>exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id,'a','a','Shelf',CANONICAL_SOURCE,'ready',JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),new Date().toISOString(),new Date().toISOString()]);
  return {db,exec,brief,
    publish:(id,input)=>postgres?pgPublish(pool,owner,id,input,options):localPublish(db,owner,id,input),
    inbox:(session,input)=>postgres?pgInbox(pool,session,options,input):localInbox(db,session,input),
    close:()=>db.close()};
}
const input=(extra={})=>({requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w1','w2'],dueAt:new Date(Date.now()+600000).toISOString(),...extra});

test('briefing target filters are bounded and reject unrelated fields',()=>{
  assert.equal(workerInboxFilters({}).briefing,'');
  assert.equal(workerInboxFilters({briefing:'qr-shelf',view:'all'}).briefing,'qr-shelf');
  for(const value of [{briefing:42},{briefing:'x'.repeat(101)},{briefing:'qr-shelf',search:'W1'},{view:'sent',briefing:'qr-shelf',history:true},{briefing:'qr-shelf',page:0}])assert.throws(()=>workerInboxFilters(value),/Invalid response filter/);
});

for(const postgres of [false,true]){
  const name=postgres?'PostgreSQL':'SQLite';
  test(`${name} briefing target resolves only the signed-in worker's matching assignment`,async()=>{
    const f=await fixture(postgres);
    try {
      await f.brief('qr-shelf');const shelf=await f.publish('qr-shelf',input());
      await f.brief('qr-ladder');const ladder=await f.publish('qr-ladder',input());
      await f.brief('qr-single');await f.publish('qr-single',input({workerIds:['w2']}));
      const targeted=await f.inbox(worker('w1'),{view:'all',page:1,pageSize:5,briefing:'qr-shelf'});
      assert.equal(targeted.total,1);assert.equal(targeted.items.length,1);
      assert.equal(targeted.items[0].briefingId,'qr-shelf');assert.equal(targeted.items[0].publicationId,shelf.id);assert.equal(targeted.items[0].id.trim().length>0,true);
      assert.ok(!JSON.stringify(targeted).includes('authority_json'));
      assert.equal((await f.inbox(worker('w1'),{view:'all',briefing:'qr-ladder'})).items[0].publicationId,ladder.id);
      assert.equal((await f.inbox(worker('w1'),{view:'all',briefing:'qr-single'})).total,0);
      assert.equal((await f.inbox(worker('w1'),{view:'all',briefing:'missing'})).total,0);
      assert.equal((await f.inbox(worker('w2'),{view:'all',briefing:'qr-shelf'})).items[0].briefingId,'qr-shelf');
      await assert.rejects(async()=>f.inbox(worker('foreign'),{view:'all',briefing:'qr-shelf'}),/Forbidden/);
      assert.equal((await f.inbox({...worker('foreign'),org_id:'b',site_id:'b'},{view:'all',briefing:'qr-shelf'})).total,0);
      const assignment=(await f.exec("SELECT id FROM assignments WHERE publication_id=? AND worker_id='w1'",[shelf.id])).rows[0].id;
      await f.exec("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES('a',?,'scan-receipt','typed',?)",[assignment,new Date().toISOString()]);
      const answered=await f.inbox(worker('w1'),{view:'all',briefing:'qr-shelf'});
      assert.equal(answered.items.length,1);assert.equal(answered.items[0].id,assignment);
      assert.equal((await f.inbox(worker('w1'),{view:'todo',briefing:'qr-shelf'})).total,0);
    } finally {await f.close();}
  });
}
