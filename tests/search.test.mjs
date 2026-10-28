import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureBriefingSchema} from '../server/preparation.mjs';
import {searchSite} from '../server/search.mjs';
import {listWorkers,getCrew,ensurePeopleSchema} from '../server/people.mjs';
import * as pg from '../server/postgres/search.mjs';
import * as people from '../server/postgres/people.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {searchFilters,searchQuery} from '../server/search-input.mjs';
import {checkedSearchPage,searchDestination,searchRoute,searchRouteQuery} from '../src/staff-search.ts';
import {sqliteApp,principalLoginBody} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'},origin='http://127.0.0.1:3020';
async function fixture(postgres){
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_search';
  const pool=postgres?{async connect(){return {async query(sql,args){return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}}:null;
  const exec=async(sql,args=[])=>postgres?db.query(sql.replaceAll('?',(()=>{let n=0;return()=>`$${++n}`;})()),args):db.prepare(sql).run(...args);
  const sql=async(text)=>postgres?(await db.query(text)).rows:db.prepare(text).all();
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations VALUES('cedar','Cedar'),('harbor','Harbor');INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('harbor-yard','harbor','Harbor','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner');");
  }else{seed(db);ensureBriefingSchema(db);ensurePeopleSchema(db);}
  const briefing=(id,org,site,title,source)=>exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[id,org,site,title,source,'draft',new Date().toISOString(),new Date().toISOString()]);
  await exec("INSERT INTO sites VALUES('tripoli','cedar','Tripoli','UTC')");
  for(const [id,role] of [['reader','auditor'],['supervisor','supervisor'],['administrator','administrator']])await exec('INSERT INTO staff(id,org_id,site_id,name,role) VALUES(?,?,?,?,?)',[id,'cedar','beirut',id,role]);
  for(let i=1;i<=31;i++)await briefing(`search-brief-${i}`,'cedar','beirut',`Match briefing ${String(i).padStart(2,'0')}`,'PRIVATE_SOURCE_RUBRIC_ANSWER_CANARY');
  for(let i=1;i<=25;i++)await exec('INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES(?,?,?,?,?,?)',[`search-worker-${i}`,'cedar','beirut',`Match worker ${i}`,'en',postgres?i%2===1:i%2]);
  for(let i=1;i<=11;i++)await exec('INSERT INTO crews(id,org_id,site_id,name,active) VALUES(?,?,?,?,?)',[`search-crew-${i}`,'cedar','beirut',`Match crew ${i}`,postgres?i%2===1:i%2]);
  await exec('INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id,joined_at) VALUES(?,?,?,?,?)',['search-worker-1','cedar','beirut','search-crew-1',new Date().toISOString()]);
  for(const [id,org,site] of [['foreign','harbor','harbor-yard'],['other-site','cedar','tripoli']]){
    await briefing(id,org,site,'Match SECRET_FOREIGN','PRIVATE_FOREIGN_SOURCE');
    await exec('INSERT INTO workers(id,org_id,site_id,code,language) VALUES(?,?,?,?,?)',[id,org,site,'Match SECRET_FOREIGN','en']);
    await exec('INSERT INTO crews(id,org_id,site_id,name) VALUES(?,?,?,?)',[id,org,site,'Match SECRET_FOREIGN']);
  }
  await exec('INSERT INTO crews(id,org_id,site_id,name) VALUES(?,?,?,?)',['arabic-crew','cedar','beirut','فريق الصباح']);
  await briefing('literal','cedar','beirut','Literal %_! title','PRIVATE_SOURCE');
  return {db,pool,schema,exec,sql,search:(s,input)=>postgres?pg.searchSite(pool,s,input,{schema}):searchSite(db,s,input),
    workers:(s,input)=>postgres?people.listWorkers(pool,s,input,{schema}):listWorkers(db,s,input),crew:(s,id)=>postgres?people.getCrew(pool,s,id,{schema}):getCrew(db,s,id),
    close:()=>db.close()};
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} global metadata search is bounded, exact-scoped, private-content-free and read-only`,async()=>{
  const f=await fixture(postgres);try{
    const before=await f.sql('SELECT * FROM audit ORDER BY id'),seen=[];
    for(let page=1;page<=4;page++){
      const result=await f.search(owner,{query:'mAtCh',page});assert.equal(result.total,67);assert.deepEqual(result.counts,{briefing:31,worker:25,crew:11});
      assert.ok(result.items.length<=20);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|SECRET_FOREIGN|org_id|site_id|source|rubric|transcript/);
      for(const item of result.items){assert.deepEqual(Object.keys(item),['id','kind','label','status']);seen.push(`${item.kind}:${item.id}`);}
    }
    assert.equal(seen.length,67);assert.equal(new Set(seen).size,67);
    assert.equal((await f.search(owner,{query:'Match',kind:'worker'})).total,25);
    assert.equal((await f.search(owner,{query:'Match',page:5})).items.length,0);
    assert.equal((await f.search(owner,{query:'PRIVATE_SOURCE_RUBRIC_ANSWER_CANARY'})).total,0);
    assert.equal((await f.search(owner,{query:'%_!'})).items[0].id,'literal');
    assert.equal((await f.search(owner,{query:"%' OR 1=1--"})).total,0);
    assert.equal((await f.search(owner,{query:'الصباح'})).items[0].id,'arabic-crew');
    const selected=await f.workers(owner,{workerId:'search-worker-24',status:'all'});assert.equal(selected.total,1);assert.equal(selected.items[0].id,'search-worker-24');
    assert.equal((await f.workers(owner,{workerId:'foreign',status:'all'})).total,0);
    assert.equal((await f.crew(owner,'search-crew-1')).member_count,1);await assert.rejects(async()=>f.crew(owner,'foreign'),/unavailable/);
    assert.deepEqual(await f.sql('SELECT * FROM audit ORDER BY id'),before);
  }finally{await f.close();}
});
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} search respects actual roles, disabled staff and archived-site directory limits`,async()=>{
  const f=await fixture(postgres);try{
    const reader={...owner,principal_id:'reader',role:'auditor'},result=await f.search(reader,{query:'Match'});
    assert.deepEqual(result.kinds,['briefing']);assert.equal(result.total,31);assert.equal(result.counts.worker,0);assert.equal(result.counts.crew,0);
    await assert.rejects(async()=>f.search(reader,{query:'Match',kind:'worker'}),/Forbidden/);
    for(const session of [{...owner,principal_type:'worker'},{...owner,principal_id:'reader'},{...owner,role:'administrator'},{...owner,org_id:'harbor'},{...owner,site_id:'tripoli'}])await assert.rejects(async()=>f.search(session,{query:'Match'}),/Forbidden/);
    await f.exec('UPDATE staff SET active=? WHERE id=?',[postgres?false:0,'supervisor']);
    await assert.rejects(async()=>f.search({...owner,principal_id:'supervisor',role:'supervisor'},{query:'Match'}),/Forbidden/);
    await f.exec("INSERT INTO site_lifecycle(site_id,org_id,revision,state,reason,updated_at) VALUES('beirut','cedar',1,'archived','pilot_closed',?)",[new Date().toISOString()]);
    assert.deepEqual((await f.search(owner,{query:'Match'})).kinds,['briefing']);
    await assert.rejects(async()=>f.search(owner,{query:'Match',kind:'crew'}),/Forbidden/);
    if(postgres){await f.exec("INSERT INTO tenant_controls(org_id,revision,state,reason) VALUES('cedar',1,'suspended','maintenance')");await assert.rejects(f.search(owner,{query:'Match'}),/paused/);}
  }finally{await f.close();}
});
test('search parsing and client receipts reject ambiguous, malformed and unbounded data or destinations',()=>{
  for(const input of [null,[],{}, {query:' '},{query:'x'.repeat(81)},{query:'a\n b'},{query:'a',page:10001},{query:'a',pageSize:21},{query:'a',kind:'notes'},{query:'a',org_id:'foreign'}])assert.throws(()=>searchFilters(input),/Invalid/);
  for(const query of ['query=a&query=b','query=a&__proto__=ignored','query=a&site_id=foreign'])assert.throws(()=>searchQuery(new URLSearchParams(query)),/Invalid/);
  assert.deepEqual(searchFilters({query:' Match '}),{query:'Match',kind:'all',page:1,pageSize:20});
  const result={query:'Match',kind:'all',page:1,pageSize:20,kinds:['briefing'],counts:{briefing:1,worker:0,crew:0},total:1,items:[{id:'brief',kind:'briefing',label:'Match title',status:'draft'}]};
  assert.deepEqual(checkedSearchPage(result,{query:'Match',kind:'all',page:1}),result);
  for(const change of [r=>{r.total=3;},r=>{r.query='Other';},r=>{r.counts.worker=1;},r=>{r.items=[null];},r=>{r.items[0].id='../foreign';},r=>{r.items.push(r.items[0]);}]){
    const altered=structuredClone(result);change(altered);assert.throws(()=>checkedSearchPage(altered,{query:'Match',kind:'all',page:1}),/verified/);
  }
  assert.equal(searchDestination(result.items[0]),'briefings/brief');assert.equal(searchDestination({kind:'worker',id:'worker-1'}),'people/worker/worker-1');
  assert.throws(()=>searchDestination({kind:'operator',id:'global'}),/unavailable/);
  assert.equal(searchRouteQuery(searchRoute('الصباح / %')),'الصباح / %');assert.throws(()=>searchRouteQuery('search/%zz'),/invalid/);
});
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} search HTTP requires current credentials and scopes deep-link reads without writes`,async()=>{
  const f=await fixture(postgres),password='Synthetic search test password only';
  const server=postgres?createPostgresRehearsalServer(f.pool,{schema:f.schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin}):
    sqliteApp(f.db,{publicOrigin:origin});
  if(postgres)await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'search@example.test',password},{schema:f.schema});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  try{
    const login=await fetch(base+('/auth/staff/login'),{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(postgres?{email:'search@example.test',password}:principalLoginBody('maya'))});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],headers={cookie};
    const session=await (await fetch(base+'/session',{headers})).json();
    assert.equal((await fetch(base+'/search?query=Match')).status,401);
    const found=await fetch(base+'/search?query=Match',{headers:{...headers,'x-client-session-context':session.clientContext}});assert.equal(found.status,200);assert.equal(found.headers.get('cache-control'),'no-store');assert.equal((await found.json()).total,67);
    for(const suffix of ['query=Match&site_id=foreign','query=Match&query=Other','query=Match&pageSize=21'])assert.equal((await fetch(base+'/search?'+suffix,{headers})).status,400);
    assert.equal((await fetch(base+'/search?query=Match',{headers:{...headers,'x-client-session-context':'0'.repeat(64)}})).status,409);
    assert.equal((await fetch(base+'/people/workers?workerId=foreign&status=all',{headers}).then(r=>r.json())).total,0);
    assert.equal((await fetch(base+'/people/crews/search-crew-1',{headers})).status,200);assert.equal((await fetch(base+'/people/crews/foreign',{headers})).status,404);
    await f.exec('UPDATE staff SET active=? WHERE id=?',[postgres?false:0,'maya']);
    assert.equal((await fetch(base+'/search?query=Match',{headers})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
});
