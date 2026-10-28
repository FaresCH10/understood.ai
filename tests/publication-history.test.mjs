import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureBriefingSchema} from '../server/preparation.mjs';
import {syntheticPrepare,CANONICAL_SOURCE} from '../server/domain.mjs';
import * as sqlite from '../server/publication-history.mjs';
import * as pg from '../server/postgres/publication-history.mjs';
import {publicationHistoryFilters,publicationHistoryQuery} from '../server/publication-history-input.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {getBriefing} from '../server/postgres/read-models.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {checkedPublicationHistory,checkedPublicationDetail} from '../src/publication-history.ts';
import {sqliteApp,principalLoginBody} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'},origin='http://127.0.0.1:3020';
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_history',queries=[];
  const pool={async connect(){return {async query(sql,args){queries.push(sql);return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};}};
  const exec=async(sql,args=[])=>postgres?db.query(sql.replaceAll('?',(()=>{let n=0;return()=>`$${++n}`;})()),args):db.prepare(sql).run(...args);
  const rows=async sql=>postgres?(await db.query(sql)).rows:db.prepare(sql).all();
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations VALUES('cedar','Cedar'),('harbor','Harbor');INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('harbor-yard','harbor','Harbor','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner');");
  }else{seed(db);ensureBriefingSchema(db);}
  await exec("INSERT INTO sites VALUES('tripoli','cedar','Tripoli','UTC')");
  for(const [id,role] of [['reader','auditor'],['supervisor','supervisor'],['administrator','administrator']])await exec('INSERT INTO staff(id,org_id,site_id,name,role) VALUES(?,?,?,?,?)',[id,'cedar','beirut',id,role]);
  for(const [id,org,site] of [['history','cedar','beirut'],['unpublished','cedar','beirut'],['foreign','harbor','harbor-yard'],['other-site','cedar','tripoli']])
    await exec("INSERT INTO briefings(id,org_id,site_id,title,source,state,created_at,updated_at) VALUES(?,?,?,'History fixture',?,'draft',?,?)",[id,org,site,CANONICAL_SOURCE,new Date().toISOString(),new Date().toISOString()]);
  for(let version=1;version<=125;version++)await exec('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)',
    [`publication-${version}`,'cedar','beirut','history',version,JSON.stringify({...syntheticPrepare(CANONICAL_SOURCE),title:'PRIVATE_SNAPSHOT_'+version}),new Date(1791800000000+version*1000).toISOString(),version===125?'published':version===1?'withdrawn':'superseded']);
  for(const [id,org,site] of [['foreign','harbor','harbor-yard'],['other-site','cedar','tripoli']])await exec('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,1,?,?,?)',[id,org,site,id,JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),new Date().toISOString(),'published']);
  const list=(session,id,input={})=>postgres?pg.listPublicationHistory(pool,session,id,input,{schema}):sqlite.listPublicationHistory(db,session,id,input);
  const detail=(session,id,pub)=>postgres?pg.getPublicationHistoryDetail(pool,session,id,pub,{schema}):sqlite.getPublicationHistoryDetail(db,session,id,pub);
  return {db,pool,schema,queries,exec,rows,list,detail,close:()=>db.close()};
}

for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} version catalog reaches every version beyond 100 without snapshots and exact detail preserves immutable evidence`,async()=>{
  const f=await fixture(postgres);try{
    const before=await f.rows('SELECT * FROM publications ORDER BY id'),seen=[];
    for(let page=1;page<=7;page++){
      const value=await f.list(owner,'history',{page});checkedPublicationHistory(value,'history',page,null);
      assert.equal(value.total,125);assert.ok(value.items.length<=20);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|source|question|rubric|snapshot|audio|org_id|site_id/);
      seen.push(...value.items.map(row=>row.version));
    }
    assert.deepEqual(seen,Array.from({length:125},(_,n)=>125-n));
    assert.equal((await f.list(owner,'history',{version:1})).items[0].id,'publication-1');
    assert.equal((await f.list(owner,'history',{version:126})).total,0);assert.equal((await f.list(owner,'history',{page:8})).items.length,0);
    assert.equal((await f.list(owner,'unpublished')).total,0);
    const oldest=await f.detail(owner,'history','publication-1');checkedPublicationDetail(oldest,'history','publication-1');assert.equal(oldest.version,1);assert.equal(oldest.state,'withdrawn');assert.equal(oldest.snapshot.title,'PRIVATE_SNAPSHOT_1');assert.equal(oldest.artifactAudio,null);
    for(const session of [owner,{...owner,principal_id:'reader',role:'auditor'},{...owner,principal_id:'supervisor',role:'supervisor'}]){
      assert.equal((await f.list(session,'history')).total,125);assert.deepEqual((await f.detail(session,'history','publication-1')).snapshot,oldest.snapshot);
    }
    for(const invalid of [{...owner,principal_type:'worker'},{...owner,principal_id:'reader'},{...owner,role:'administrator',principal_id:'administrator'},{...owner,org_id:'harbor'},{...owner,site_id:'tripoli'},{...owner,token_hash:'f'.repeat(64)}]){
      await assert.rejects(async()=>f.list(invalid,'history'),/Forbidden|Sign in required/);await assert.rejects(async()=>f.detail(invalid,'history','publication-1'),/Forbidden|Sign in required/);
    }
    for(const id of ['foreign','other-site','unpublished'])await assert.rejects(async()=>f.detail(owner,'history',id),/unavailable/);
    for(const id of ['foreign','other-site'])await assert.rejects(async()=>f.list(owner,id),/unavailable/);
    await f.exec('UPDATE staff SET active=? WHERE id=?',[postgres?false:0,'reader']);await assert.rejects(async()=>f.list({...owner,principal_id:'reader',role:'auditor'},'history'),/Forbidden/);
    assert.deepEqual(await f.rows('SELECT * FROM publications ORDER BY id'),before);
    if(postgres){const current=await getBriefing(f.pool,owner,'history',{schema:f.schema});assert.equal(current.publications.length,1);assert.equal(current.publications[0].version,125);assert.ok(f.queries.some(sql=>sql.includes('ISOLATION LEVEL REPEATABLE READ')));
      await f.exec("INSERT INTO tenant_controls(org_id,revision,state,reason) VALUES('cedar',1,'suspended','maintenance')");await assert.rejects(f.list(owner,'history'),/paused/);await assert.rejects(f.detail(owner,'history','publication-1'),/paused/);}
  }finally{await f.close();}
});

for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} version history HTTP is no-store, current-session scoped, read-only and rejects ambiguous input`,async()=>{
  const f=await fixture(postgres),password='Synthetic history test password only';
  const server=postgres?createPostgresRehearsalServer(f.pool,{schema:f.schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin}):sqliteApp(f.db,{publicOrigin:origin});
  if(postgres)await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'history@example.test',password},{schema:f.schema});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  try{
    const login=await fetch(base+('/auth/staff/login'),{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(postgres?{email:'history@example.test',password}:principalLoginBody('maya'))});assert.equal(login.status,200);
    const headers={cookie:login.headers.get('set-cookie').split(';')[0]},session=await (await fetch(base+'/session',{headers})).json(),context={...headers,'x-client-session-context':session.clientContext};
    assert.equal((await fetch(base+'/briefings/history/publications')).status,401);
    const before=await f.rows('SELECT * FROM audit ORDER BY id');
    const history=await fetch(base+'/briefings/history/publications?page=7&pageSize=20',{headers:context});assert.equal(history.status,200);assert.equal(history.headers.get('cache-control'),'no-store');assert.equal((await history.json()).items.at(-1).version,1);
    const exact=await fetch(base+'/briefings/history/publications/publication-1',{headers:context});assert.equal(exact.status,200);assert.equal((await exact.json()).snapshot.title,'PRIVATE_SNAPSHOT_1');
    assert.equal((await fetch(base+'/briefings/history',{headers:context}).then(r=>r.json())).publications.length,1);
    for(const suffix of ['?page=1&page=2','?pageSize=21','?site_id=foreign','?version=0','/publication-1?page=1'])assert.equal((await fetch(base+'/briefings/history/publications'+suffix,{headers:context})).status,400);
    assert.equal((await fetch(base+'/briefings/history/publications',{headers:{...headers,'x-client-session-context':'0'.repeat(64)}})).status,409);
    assert.notEqual((await fetch(base+'/briefings/history/publications/foreign',{headers:context})).status,200);
    assert.deepEqual(await f.rows('SELECT * FROM audit ORDER BY id'),before);
    await f.exec('UPDATE staff SET active=? WHERE id=?',[postgres?false:0,'maya']);assert.equal((await fetch(base+'/briefings/history/publications',{headers:context})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('version filter and client projections reject foreign, private, duplicate, invalid and inconsistent evidence',()=>{
  for(const input of [null,[],{org_id:'other'},{page:0},{page:'1e2'},{pageSize:21},{version:-1},{version:2147483648},{version:['1']}])assert.throws(()=>publicationHistoryFilters(input),/Invalid/);
  for(const query of ['page=1&page=2','version=1&version=2','site_id=other'])assert.throws(()=>publicationHistoryQuery(new URLSearchParams(query)),/Invalid/);
  assert.throws(()=>publicationHistoryQuery(new URLSearchParams('version=1'),true),/Invalid/);
  const row={id:'publication-1',version:1,state:'published',published_at:'2026-10-12T12:00:00.000Z'},page={briefingId:'history',items:[row],total:1,page:1,pageSize:20,version:null};
  assert.deepEqual(checkedPublicationHistory(page,'history',1,null),page);
  for(const change of [v=>v.briefingId='foreign',v=>v.page=2,v=>v.total=2,v=>v.items[0].snapshot={rubric:'PRIVATE'},v=>v.items[0].id='../foreign',v=>v.items[0].state='draft',v=>v.items[0].version=0,v=>{v.items.push(v.items[0]);v.total=2;}]){const value=structuredClone(page);change(value);assert.throws(()=>checkedPublicationHistory(value,'history',1,null),/unavailable/);}
  const detail={...row,briefingId:'history',snapshot:syntheticPrepare(CANONICAL_SOURCE),artifactAudio:null,withdrawal:null,metrics:{assigned:1,responses:0,matches:0,clarifications:0,unassessed:0,pending:1,completion:0}};
  checkedPublicationDetail(detail,'history','publication-1');
  const acknowledged={...detail,metrics:{assigned:1,responses:1,matches:0,clarifications:0,unassessed:0,acknowledged:1,pending:0,completion:100}};
  checkedPublicationDetail(acknowledged,'history','publication-1');
  for(const change of [v=>v.id='foreign',v=>v.briefingId='foreign',v=>v.snapshot=null,v=>v.metrics.responses=0,v=>v.metrics.completion=80,v=>v.secret='private',v=>v.metrics.acknowledged=2,v=>v.metrics.unassessed=1]){const value=structuredClone(acknowledged);change(value);assert.throws(()=>checkedPublicationDetail(value,'history','publication-1'),/unavailable/);}
});
