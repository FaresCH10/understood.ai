import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {listReverificationCandidates} from '../server/reverification.mjs';
import {listReverificationCandidates as listPostgresCandidates} from '../server/postgres/reverification.mjs';
import {reverificationFilters,reverificationPage} from '../server/reverification-input.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';

const fetch=createSessionContextFetch();
const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'};
const days=value=>new Date(Date.now()-value*86400000).toISOString();
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_reverification';
  const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  const exec=async(sql,values=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...values)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}else seed(db);
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('supervisor','a','a','Supervisor','supervisor'),('reader','a','a','Reader','auditor'),('off','a','a','Off','owner')");
  await exec('UPDATE staff SET active=? WHERE id=?',[postgres?false:0,'off']);
  const worker=async(id,{active=true,required=false,org='a',site='a'}={})=>exec('INSERT INTO workers(id,org_id,site_id,code,language,active,language_selection_required) VALUES(?,?,?,?,?,?,?)',
    [id,org,site,`Worker ${id}`,'en',postgres?active:Number(active),postgres?required:Number(required)]);
  for(const id of ['w1','w2','w7','w9','w10'])await worker(id);
  await worker('inactive',{active:false});await worker('required',{required:true});
  await exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ['brief','a','a','Shelf','Synthetic shelf source','ready',null,days(200),days(200)]);
  await exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ['other','a','a','Other shelf','Synthetic other source','ready',null,days(200),days(200)]);
  const publication=async(id,briefing,version,state='published')=>exec('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)',
    [id,'a','a',briefing,version,'{"title":"Shelf","languages":{"en":{}}}',days(100),state]);
  await publication('p1','brief',1,'superseded');await publication('p2','brief',2);await publication('p3','brief',3,'withdrawn');await publication('p4','other',1);
  const assignment=async(id,publicationId,workerId)=>exec('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)',
    [id,'a','a',publicationId,workerId,null,days(100),'en']);
  for(const [assignmentId,publicationId,workerId] of [['a1','p1','w1'],['a2','p2','w1'],['a3','p2','w2'],['a4','p2','w7'],['a5','p3','w1'],
    ['a6','p1','w9'],['a7','p1','w10'],['a8','p1','inactive'],['a10','p4','w1']])await assignment(assignmentId,publicationId,workerId);
  const attempt=async(id,assignmentId,outcome,age)=>{
    if(postgres)return exec('INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [id,'a','a',assignmentId,id,'private answer',outcome,'[]',days(age)]);
    return exec('INSERT INTO attempts(id,org_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at) VALUES(?,?,?,?,?,?,?,?)',
      [id,'a',assignmentId,id,'private answer',outcome,'[]',days(age)]);
  };
  for(const row of [['t1','a1','matched',100],['t2','a1','matched',60],['t3','a2','matched',10],['t4','a3','clarification',50],
    ['t5','a4','matched',80],['t6','a4','unassessable',20],['t7','a6','matched',45],['t8','a7','matched',120],['t9','a8','matched',40],
    ['t11','a10','matched',30]])await attempt(...row);
  return {db,pool,schema,exec,list:(s,input)=>postgres?listPostgresCandidates(pool,s,'brief',input,{schema}):listReverificationCandidates(db,s,'brief',input),close:()=>db.close()};
}

for(const postgres of [false,true]) {
  test(`${postgres?'PostgreSQL':'SQLite'} re-verification uses each worker's latest scoped response and an explicit aging window`,async()=>{
    const f=await fixture(postgres);
    try {
      const matched=await f.list(owner,{window:'any',outcome:'matched'});
      assert.deepEqual(matched.items.map(row=>row.id),['w10','w9','w1']);
      assert.deepEqual(Object.keys(matched.items[0]),['id','code','language','outcome','lastRespondedAt','version']);
      assert.equal(matched.items[0].version,1);assert.equal(matched.items[0].outcome,'matched');
      assert.equal(matched.items.find(row=>row.id==='w1').version,2);assert.match(matched.items[0].lastRespondedAt,/Z$/);
      assert.ok(!JSON.stringify(matched).includes('private answer'));
      assert.equal(matched.total,3);assert.equal(matched.window,'any');assert.equal(matched.outcome,'matched');assert.equal(matched.truncated,false);
      assert.deepEqual((await f.list(owner,{window:'30',outcome:'matched'})).items.map(row=>row.id),['w10','w9']);
      assert.deepEqual((await f.list(owner,{window:'90',outcome:'matched'})).items.map(row=>row.id),['w10']);
      assert.deepEqual((await f.list(owner,{window:'180',outcome:'matched'})).items,[]);
      assert.deepEqual((await f.list(owner,{window:'any',outcome:'response'})).items.map(row=>row.id),['w10','w2','w9','w7','w1']);
      assert.equal((await f.list(owner,{window:'any',outcome:'response'})).items.find(row=>row.id==='w2').outcome,'clarification');
      for(const staff of [{...owner,principal_id:'supervisor',role:'supervisor'},owner])assert.equal((await f.list(staff,{window:'any',outcome:'matched'})).total,3);
      for(const staff of [{...owner,principal_id:'reader',role:'auditor'},{...owner,principal_id:'off'},{...owner,principal_type:'worker'},
        {...owner,org_id:'b'},{...owner,site_id:'b'}])await assert.rejects(async()=>f.list(staff,{window:'any',outcome:'matched'}),/Forbidden/);
      await assert.rejects(async()=>f.list(owner,{window:'7',outcome:'matched'}),/Invalid re-verification filter/);
      await assert.rejects(async()=>f.list(owner,{window:'any',outcome:'anything'}),/Invalid re-verification filter/);
    }finally {await f.close();}
  });
}

test('re-verification filters reject unknown fields and paging normalizes dates',()=>{
  for(const input of [null,[],{window:30},{outcome:'matched',extra:true},{window:'any',outcome:'response',workerId:'w1'}])
    assert.throws(()=>reverificationFilters(input),/Invalid re-verification filter/);
  const page=reverificationPage([{id:'w1',code:'W1',language:'en',outcome:'matched',received_at:new Date('2026-10-01T09:00:00.000Z'),version:2}],reverificationFilters());
  assert.equal(page.items[0].lastRespondedAt,'2026-10-01T09:00:00.000Z');assert.equal(page.total,1);
});

test('re-verification HTTP is no-store, scoped and rejects forged filters',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db,{publicOrigin:'http://127.0.0.1:3020'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const login=async principal=>(await loginPrincipal(base,principal)).headers.get('set-cookie').split(';')[0];
    const cookie=await login('maya'),foreign=await login('harbor-owner'),worker=await login('worker-29');
    const url=`${base}/briefings/shelf/reverification?window=any&outcome=matched`;
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{cookie:worker}})).status,403);
    assert.equal((await fetch(url,{headers:{cookie:foreign}})).status,404);
    const response=await fetch(url,{headers:{cookie}});assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const result=await response.json();assert.ok(result.items.length>0);assert.equal(result.outcome,'matched');assert.equal(result.window,'any');
    assert.deepEqual(Object.keys(result.items[0]),['id','code','language','outcome','lastRespondedAt','version']);
    assert.ok(!JSON.stringify(result).includes('answer_text'));
    assert.equal((await globalThis.fetch(url,{headers:{cookie}})).status,409);
    assert.equal((await fetch(`${base}/briefings/shelf/reverification?window=7`,{headers:{cookie}})).status,400);
    assert.equal((await fetch(`${base}/briefings/shelf/reverification?outcome=matched&site_id=b`,{headers:{cookie}})).status,400);
    assert.equal((await fetch(`${base}/briefings/missing/reverification`,{headers:{cookie}})).status,404);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
