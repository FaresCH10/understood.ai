import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {listCrewRecipients,crewRecipientId,ensurePeopleSchema} from '../server/people.mjs';
import * as pg from '../server/postgres/people.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {CANONICAL_SOURCE,syntheticPrepare,publish} from '../server/domain.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'},origin='http://127.0.0.1:3020';
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_crew_recipients';let fail=false;
  const client={async query(sql,values){if(fail && sql.startsWith('SELECT w.id,w.code,w.name,w.language'))throw Error('Private database sentinel');return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  const exec=async(sql,values=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...values)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}else {seed(db);ensurePeopleSchema(db);}
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('c','a','C','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('reader','a','a','Reader','auditor')");
  await exec("INSERT INTO crews(id,org_id,site_id,name) VALUES('crew','a','a','Crew'),('empty','a','a','Empty'),('other-site','a','c','Other site'),('foreign','b','b','Foreign')");
  await exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',['brief','a','a','Shelf',CANONICAL_SOURCE,'ready',JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),new Date().toISOString(),new Date().toISOString()]);
  return {db,pool,schema,exec,list:(s,id,input)=>postgres?pg.listCrewRecipients(pool,s,id,input,{schema}):listCrewRecipients(db,s,id,input),publish:input=>postgres?pgPublish(pool,owner,'brief',input,{schema,integrationMode:'synthetic'}):publish(db,owner,'brief',input),setFail:value=>{fail=value;},close:()=>db.close()};
}
async function member(f,id,{crew='crew',active=true,org='a',site='a'}={}) {
  await f.exec('INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES(?,?,?,?,?,?)',[id,org,site,`Worker ${id}`,'en',f.db instanceof PGlite?active:Number(active)]);
  await f.exec('INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id,joined_at) VALUES(?,?,?,?,?)',[id,org,site,crew,new Date().toISOString()]);
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} crew recipient snapshot is bounded, scoped, read-only and remains an explicit publish audience`,async()=>{
  const f=await fixture(postgres);
  try {
    for(let n=0;n<125;n++)await member(f,String(n).padStart(3,'0'));
    await member(f,'inactive',{active:false});await member(f,'offsite',{crew:'other-site',site:'c'});await member(f,'outside',{crew:'foreign',org:'b',site:'b'});
    const before=(await f.exec('SELECT count(*) AS n FROM audit')).rows[0].n,preview=await f.list(owner,'crew');
    assert.equal(preview.items.length,125);assert.equal(preview.items[0].id,'000');assert.equal(preview.items.at(-1).id,'124');
    assert.deepEqual(preview.crew,{id:'crew',name:'Crew'});assert.deepEqual(Object.keys(preview.items[0]),['id','code','name','language','crew_name']);
    assert.equal((await f.exec('SELECT count(*) AS n FROM audit')).rows[0].n,before);
    assert.deepEqual((await f.list(owner,'empty')).items,[]);
    for(const s of [{...owner,principal_type:'worker'},{...owner,role:'administrator'},{...owner,principal_id:'reader',role:'auditor'},{...owner,site_id:'c'},{...owner,org_id:'b'},{...owner,token_hash:'f'.repeat(64)}])await assert.rejects(async()=>f.list(s,'crew'),/Forbidden|Sign in required/);
    for(const id of ['other-site','foreign','missing'])await assert.rejects(async()=>f.list(owner,id),/Crew unavailable/);
    await f.exec("DELETE FROM crew_memberships WHERE worker_id='000'");await member(f,'new');
    const input={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:preview.items.map(w=>w.id)};
    const publication=await f.publish(input);assert.equal(publication.assigned,125);
    const ids=(await f.exec('SELECT worker_id FROM assignments WHERE publication_id=? ORDER BY worker_id',[publication.id])).rows.map(row=>row.worker_id);
    assert.deepEqual(ids,input.workerIds);assert.ok(ids.includes('000'));assert.ok(!ids.includes('new'));
    assert.equal((await f.publish(input)).duplicate,true);
    await f.exec(`UPDATE crews SET active=${postgres?'false':'0'} WHERE id='crew'`);await assert.rejects(async()=>f.list(owner,'crew'),/Crew unavailable/);
    await f.exec(`UPDATE crews SET active=${postgres?'true':'1'} WHERE id='crew'`);
    if(postgres) {
      await f.exec("INSERT INTO workers(id,org_id,site_id,code,language) SELECT 'bulk-'||n,'a','a','Bulk '||n,'en' FROM generate_series(1,4877) n");
      await f.exec("INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id,joined_at) SELECT id,'a','a','crew',NOW() FROM workers WHERE id LIKE 'bulk-%'");
    }else for(let n=1;n<=4877;n++)await member(f,`bulk-${n}`);
    await assert.rejects(async()=>f.list(owner,'crew'),/limit exceeded/);
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='owner'`);await assert.rejects(async()=>f.list(owner,'crew'),/Forbidden/);
  }finally {await f.close();}
});
test('crew snapshot accepts no filter/scope overrides or invalid IDs',()=>{
  for(const id of ['',null,[], 'x'.repeat(101)])assert.throws(()=>crewRecipientId(id),/Invalid/);
  for(const input of [null,[],{page:1},{language:'en'},{site_id:'b'}])assert.throws(()=>crewRecipientId('crew',input),/Invalid/);
});
test('SQLite crew recipient HTTP denies workers/foreign scope, is no-store and sanitizes failures',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db,{publicOrigin:origin});
  db.prepare("INSERT INTO crews VALUES('preview','cedar','beirut','Preview',1)").run();
  db.prepare("INSERT INTO crew_memberships VALUES('worker-29','cedar','beirut','preview',?)").run(new Date().toISOString());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>(await loginPrincipal(base, principal, origin)).headers.get('set-cookie').split(';')[0];
  try {
    const cookie=await login('maya'),worker=await login('worker-29'),foreign=await login('harbor-owner'),url=`${base}/people/crews/preview/recipients`;
    assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{cookie:worker}})).status,403);assert.equal((await fetch(url,{headers:{cookie:foreign}})).status,400);
    assert.equal((await fetch(`${url}?site_id=beirut`,{headers:{cookie}})).status,400);
    const response=await fetch(url,{headers:{cookie}});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).items.length,1);
    db.exec('ALTER TABLE crew_memberships RENAME TO fixture_missing_memberships');const failure=await fetch(url,{headers:{cookie}});assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:'Crew recipients unavailable'});
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
test('PostgreSQL credential crew recipient HTTP revalidates authority and sanitizes query failures',async()=>{
  const f=await fixture(true),password='Disposable crew password only';await member(f,'000');
  await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'crew@example.test',password},{schema:f.schema});
  const server=createPostgresRehearsalServer(f.pool,{schema:f.schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const login=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'crew@example.test',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],url=`${base}/people/crews/crew/recipients`;
    assert.equal((await fetch(url)).status,401);assert.equal((await fetch(`${url}?language=en`,{headers:{cookie}})).status,400);
    const response=await fetch(url,{headers:{cookie}});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).items.length,1);
    f.setFail(true);const failure=await fetch(url,{headers:{cookie}});assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/Private|sentinel/);f.setFail(false);
    await f.exec("UPDATE sessions SET revoked_at=NOW() WHERE principal_id='owner'");assert.equal((await fetch(url,{headers:{cookie}})).status,401);
  }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});
