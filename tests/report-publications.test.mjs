import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {listReportPublications,reportPublicationFilters,reportPublicationPage} from '../server/reports.mjs';
import * as pg from '../server/postgres/reports.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';

const owner={principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'},origin='http://127.0.0.1:3020';
async function fixture(postgres) {
  if(!postgres){
    const db=openDatabase(':memory:');seed(db);
    db.prepare("INSERT INTO sites VALUES('tripoli','cedar','Tripoli','UTC')").run();
    db.prepare("INSERT INTO briefings VALUES('tripoli-brief','cedar','tripoli','Tripoli','Private',1,1,'draft',NULL,?,?)").run(new Date().toISOString(),new Date().toISOString());
    db.prepare("INSERT INTO staff VALUES('reader','cedar','beirut','Reader','auditor',1)").run();
    return {db,list:(s,input)=>listReportPublications(db,s,input),exec:async(sql,values=[])=>db.prepare(sql).run(...values),close:()=>db.close()};
  }
  const db=new PGlite(),schema='understood_test_report_publications';let fail=false;
  const client={async query(sql,values){if(fail && sql.startsWith('SELECT id,version,state,published_at'))throw Error('Injected secret failure');return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec("INSERT INTO organizations VALUES('cedar','Cedar'),('harbor','Harbor');INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('tripoli','cedar','Tripoli','UTC'),('harbor-yard','harbor','Harbor','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('reader','cedar','beirut','Reader','auditor');INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('shelf','cedar','beirut','Shelf','Private','draft'),('tripoli-brief','cedar','tripoli','Tripoli','Private','draft'),('harbor-brief','harbor','harbor-yard','Harbor','Private','draft');");
  return {db,pool,schema,list:(s,input)=>pg.listReportPublications(pool,s,input,{schema}),exec:async(sql,values=[])=>{let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);},setFail:value=>{fail=value;},close:()=>db.close()};
}
async function publication(f,id,version,title,time,org='cedar',site='beirut',briefing='shelf') {
  await f.exec('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)',[id,org,site,briefing,version,JSON.stringify({title,rubric:'Private rubric sentinel',source:'Private source sentinel'}),time,'superseded']);
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} report publication paging exceeds 100 versions, uses exact site civil dates and preserves private scope`,async()=>{
  const f=await fixture(postgres);
  try {
    for(let n=0;n<125;n++)await publication(f,`archive-${String(n).padStart(3,'0')}`,100+n,`Archive ${n}`,'2026-01-01T00:00:00.000Z');
    await publication(f,'foreign',1,'Archive foreign','2026-01-01T00:00:00.000Z','harbor','harbor-yard','harbor-brief');
    await publication(f,'other-site',1,'Archive other site','2026-01-01T00:00:00.000Z','cedar','tripoli','tripoli-brief');
    await publication(f,'literal',999,'Literal %_ term','2026-01-01T00:00:00.000Z');
    const first=await f.list(owner,{search:'ARCHIVE'}),last=await f.list(owner,{search:'archive',page:7});
    assert.equal(first.total,125);assert.equal(first.items.length,20);assert.equal(first.items[0].id,'archive-124');assert.equal(last.items.length,5);assert.equal(last.items.at(-1).id,'archive-000');
    assert.equal((await f.list(owner,{search:'%_'})).total,1);
    assert.deepEqual(Object.keys(first.items[0]),['id','title','version','state','publishedAt']);
    assert.doesNotMatch(JSON.stringify(first),/rubric|source|foreign|other.site|snapshot/);
    assert.equal((await f.list({...owner,principal_id:'reader',role:'auditor'},{search:'Archive'})).total,125);
    for(const [id,time] of [['spring-before','2026-03-28T21:59:59.000Z'],['spring-start','2026-03-28T22:00:00.000Z'],['spring-end','2026-03-29T20:59:59.000Z'],['spring-after','2026-03-29T21:00:00.000Z'],['fall-before','2026-10-24T21:59:59.000Z'],['fall-start','2026-10-24T22:00:00.000Z'],['fall-end','2026-10-25T21:59:59.000Z'],['fall-after','2026-10-25T22:00:00.000Z']])await publication(f,id,1000+['spring-before','spring-start','spring-end','spring-after','fall-before','fall-start','fall-end','fall-after'].indexOf(id),id,time);
    assert.deepEqual((await f.list(owner,{from:'2026-03-29',through:'2026-03-29'})).items.map(r=>r.id),['spring-end','spring-start']);
    const fall=await f.list(owner,{search:'fall-',from:'2026-10-25',through:'2026-10-25'});assert.equal(fall.timezone,'Asia/Beirut');assert.deepEqual(fall.items.map(r=>r.id),['fall-end','fall-start']);
    assert.equal((await f.list(owner,{through:'2025-12-31'})).total,0);assert.equal((await f.list(owner,{search:'archive',page:8})).items.length,0);
    for(const s of [{...owner,principal_type:'worker'},{...owner,role:'administrator'},{...owner,org_id:'harbor'},{...owner,site_id:'tripoli'},{...owner,token_hash:'f'.repeat(64)}])await assert.rejects(async()=>f.list(s),/Forbidden|Sign in required/);
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='maya'`);await assert.rejects(async()=>f.list(owner),/Forbidden/);
  }finally {await f.close();}
});
test('report publication filters reject impossible dates, reversed ranges and arbitrary scope; candidate limit is explicit',()=>{
  for(const input of [null,[],{org_id:'harbor'},{search:'x'.repeat(121)},{page:0},{page:5001},{pageSize:51},{from:[]},{from:'0000-01-01'},{from:'2026-02-29'},{through:'2026-04-31'},{from:'2026-10-02',through:'2026-10-01'}])assert.throws(()=>reportPublicationFilters(input),/Invalid/);
  assert.equal(reportPublicationFilters({from:'2028-02-29'}).from,'2028-02-29');
  assert.throws(()=>reportPublicationPage(Array(5001),reportPublicationFilters(),'UTC'),/exceeds limit/);
});
test('SQLite publication history HTTP is read-only, scope protected and bounded',async()=>{
  const db=openDatabase(':memory:'),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo',publicOrigin:origin});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>(await fetch(`${base}/demo/session`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({principal})})).headers.get('set-cookie').split(';')[0];
  try {
    const cookie=await login('maya'),worker=await login('worker-29'),foreign=await login('harbor-owner'),before=db.prepare('SELECT COUNT(*) n FROM audit').get().n;
    assert.equal((await fetch(`${base}/reports/publications`)).status,401);assert.equal((await fetch(`${base}/reports/publications`,{headers:{cookie:worker}})).status,403);
    for(const query of ['org_id=harbor','from=2026-02-29','pageSize=100'])assert.equal((await fetch(`${base}/reports/publications?${query}`,{headers:{cookie}})).status,400);
    const response=await fetch(`${base}/reports/publications`,{headers:{cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).items[0].id,'shelf-v3');
    assert.equal((await (await fetch(`${base}/reports/publications`,{headers:{cookie:foreign}})).json()).total,0);
    for(const query of ['orgId=harbor','responseFrom=2026-02-29','responseFrom=2026-10-03&responseThrough=2026-10-02'])assert.equal((await fetch(`${base}/reports?${query}`,{headers:{cookie}})).status,400);
    const report=await fetch(`${base}/reports?responseFrom=2026-10-25&responseThrough=2026-10-25`,{headers:{cookie}});
    assert.equal(report.status,200);assert.equal(report.headers.get('cache-control'),'no-store');assert.equal((await report.json()).crewSnapshotAvailable,false);
    assert.equal((await fetch(`${base}/reports?crewId=unknown`,{headers:{cookie}})).status,409);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n,before);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();assert.equal((await fetch(`${base}/reports/publications`,{headers:{cookie}})).status,401);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
test('PostgreSQL credential publication history HTTP rejects overrides/revocation and sanitizes service failure',async()=>{
  const f=await fixture(true),password='Disposable report password only';
  const server=createPostgresRehearsalServer(f.pool,{schema:f.schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
  await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'report@example.test',password},{schema:f.schema});
  await publication(f,'report-http',1,'Report HTTP','2026-10-02T00:00:00.000Z');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const login=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'report@example.test',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/reports/publications`)).status,401);
    assert.equal((await fetch(`${base}/reports/publications?site_id=tripoli`,{headers:{cookie}})).status,400);
    const list=await fetch(`${base}/reports/publications?from=2026-10-02&through=2026-10-02`,{headers:{cookie}});assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).total,1);
    for(const query of ['orgId=harbor','responseFrom=2026-02-29','responseFrom=2026-10-03&responseThrough=2026-10-02'])assert.equal((await fetch(`${base}/reports?${query}`,{headers:{cookie}})).status,400);
    const report=await fetch(`${base}/reports?publicationId=report-http&responseFrom=2026-10-25&responseThrough=2026-10-25`,{headers:{cookie}});
    assert.equal(report.status,200);assert.equal(report.headers.get('cache-control'),'no-store');assert.equal((await report.json()).crewSnapshotAvailable,false);
    assert.equal((await fetch(`${base}/reports?publicationId=report-http&crewId=unknown`,{headers:{cookie}})).status,409);
    f.setFail(true);const failure=await fetch(`${base}/reports/publications`,{headers:{cookie}});assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/Injected|secret/);f.setFail(false);
    await f.exec('UPDATE sessions SET revoked_at=? WHERE principal_id=?',[new Date().toISOString(),'maya']);assert.equal((await fetch(`${base}/reports/publications`,{headers:{cookie}})).status,401);
  }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});
