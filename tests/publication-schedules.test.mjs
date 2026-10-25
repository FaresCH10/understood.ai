import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {CANONICAL_SOURCE,syntheticPrepare,publish} from '../server/domain.mjs';
import * as local from '../server/schedules.mjs';
import * as pg from '../server/postgres/schedules.mjs';
import {scheduleInput,schedulePage,scheduleCancel,scheduleHttpError} from '../server/schedule-input.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createSession} from '../server/auth.mjs';

const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'},origin='http://127.0.0.1:3020';
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_publication_schedules';let fail=false,clock=null;
  if(!postgres){const prepare=db.prepare.bind(db);db.prepare=sql=>{if(fail && sql.startsWith('SELECT id,language,language_selection_required FROM workers'))throw Error('Private scheduler database sentinel');return prepare(sql);};}
  const client={async query(sql,values){if(fail && sql.startsWith('SELECT id,language,language_selection_required::int AS language_selection_required'))throw Error('Private scheduler database sentinel');if(clock!==null)sql=sql.replaceAll('clock_timestamp()',`'${new Date(clock).toISOString()}'::timestamptz`);return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}},options={schema,integrationMode:'synthetic'};
  const exec=async(sql,values=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...values)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}else seed(db);
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('other','a','Other','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('reader','a','a','Reader','auditor')");
  await exec("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','W1','en'),('w2','a','a','W2','ar'),('foreign','b','b','Foreign','en')");
  const createBrief=async id=>exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,'a','a','Shelf',CANONICAL_SOURCE,'ready',JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),new Date().toISOString(),new Date().toISOString()]);
  return {db,pool,options,exec,createBrief,create:(s,id,input)=>postgres?pg.createSchedule(pool,s,id,input,options):local.createSchedule(db,s,id,input),
    list:(s,id,input)=>postgres?pg.listSchedules(pool,s,id,input,options):local.listSchedules(db,s,id,input),
    cancel:(s,id,request,input={confirmed:true})=>postgres?pg.cancelSchedule(pool,s,id,request,input,options):local.cancelSchedule(db,s,id,request,input),
    process:()=>postgres?pg.processOneSchedule(pool,options):local.processOneSchedule(db),setFail:value=>{fail=value;},setClock:value=>{clock=value;},close:()=>db.close()};
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} scheduler retries infrastructure failures with bounded durable backoff without exposing errors`,async t=>{
  const f=await fixture(postgres),now=Date.now();t.mock.timers.enable({apis:['Date'],now});f.setClock(now);
  const advance=ms=>{t.mock.timers.setTime(ms);f.setClock(ms);};
  try {
    await f.createBrief('brief');const request=input();await f.create(owner,'brief',request);advance(now+2000);f.setFail(true);
    assert.equal(await f.process(),true);let row=(await f.list(owner,'brief')).items[0];assert.equal(row.state,'queued');assert.equal(row.attempts,1);assert.equal(row.error,null);assert.ok(row.retryAt);assert.equal(await f.process(),false);
    advance(Date.parse(row.retryAt)+1);assert.equal(await f.process(),true);row=(await f.list(owner,'brief')).items[0];assert.equal(row.attempts,2);assert.equal(row.state,'queued');
    advance(Date.parse(row.retryAt)+1);assert.equal(await f.process(),true);row=(await f.list(owner,'brief')).items[0];assert.equal(row.state,'failed');assert.equal(row.attempts,3);assert.equal(row.retryAt,null);assert.equal(row.error,'Publication service unavailable after three attempts');
    assert.equal(await f.process(),false);assert.equal((await f.exec("SELECT count(*) n FROM publications WHERE org_id='a'")).rows[0].n,0);
  }finally {await f.close();}
});
const input=(extra={})=>({requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w2','w1'],publishAt:new Date(Date.now()+1500).toISOString(),dueAt:new Date(Date.now()+600000).toISOString(),...extra});
const waitUntil=async date=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(date)-Date.now()+100)));};

for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} briefing library filters the current schedule independently of publication and minimizes scoped history`,async t=>{
  const f=await fixture(postgres),now=Date.now();t.mock.timers.enable({apis:['Date'],now});f.setClock(now);
  const advance=ms=>{t.mock.timers.setTime(ms);f.setClock(ms);};
  const config={tier:'local',aiMode:'synthetic',accessMode:postgres?'credential':'demo',publicOrigin:origin,schema:f.options.schema,dataClass:'synthetic'};
  const password='Disposable library password only';
  for(const staffId of ['owner','reader']) {
    if(postgres)await provisionStaffCredential(f.pool,{staffId,orgId:'a',siteId:'a',email:`${staffId}@example.test`,password},{schema:f.options.schema});
  }
  const server=postgres?createPostgresRehearsalServer(f.pool,config):createAppServer(f.db,config);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async staffId=> {
    if(!postgres)return `understood_session=${createSession(f.db,f.db.prepare('SELECT * FROM staff WHERE id=?').get(staffId),'staff','demo').token}`;
    const response=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:`${staffId}@example.test`,password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
  };
  try {
    const cookie=await login('owner'),reader=await login('reader');
    for(const id of ['queued','cancelled','failed','published','none'])await f.createBrief(id);
    const old=input({requestId:'ffffffff-ffff-4fff-afff-ffffffffffff',publishAt:new Date(now+60000).toISOString()});
    await f.create(owner,'queued',old);await f.cancel(owner,'queued',old.requestId);
    const queued=input({requestId:'00000000-0000-4000-a000-000000000000',publishAt:old.publishAt});await f.create(owner,'queued',queued);
    const cancel=input({publishAt:old.publishAt});await f.create(owner,'cancelled',cancel);await f.cancel(owner,'cancelled',cancel.requestId);
    await f.create(owner,'failed',input());await f.exec("UPDATE briefings SET revision=2 WHERE id='failed'");
    await f.create(owner,'published',input());advance(now+2000);assert.equal(await f.process(),true);assert.equal(await f.process(),true);assert.equal(await f.process(),false);
    await f.exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',['hidden','b','b','Shelf secret',CANONICAL_SOURCE,'ready',null,new Date().toISOString(),new Date().toISOString()]);
    const before=JSON.stringify((await f.exec('SELECT id,state,attempts FROM publication_schedules ORDER BY id')).rows);
    const read=async(query='',actor=cookie)=>{const response=await fetch(`${base}/briefings?${query}`,{headers:{cookie:actor}});assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
    for(const state of ['queued','cancelled','failed','published']) {
      const result=await read(`scheduleStatus=${state}&search=shelf`);assert.equal(result.total,1);assert.equal(result.items[0].id,state);assert.equal(result.items[0].schedule_state,state);assert.ok(result.items[0].scheduled_for);
      for(const privateField of ['request_json','snapshot_hash','recipients_json','requested_by','authority_json','workerIds','error'])assert.ok(!Object.hasOwn(result.items[0],privateField));
    }
    assert.equal((await read('scheduleStatus=none')).total,1);
    assert.equal((await read('scheduleStatus=queued&publicationStatus=unpublished&status=ready')).total,1);
    assert.equal((await read('scheduleStatus=queued&publicationStatus=published')).total,0);
    assert.equal((await read('scheduleStatus=published&publicationStatus=published')).total,1);
    assert.equal((await read('scheduleStatus=queued',reader)).total,1);
    const paged=await read('page=2&pageSize=2&sort=title');assert.equal(paged.total,5);assert.equal(paged.items.length,2);assert.equal((await read('page=4&pageSize=2')).items.length,0);
    assert.equal((await fetch(`${base}/briefings?scheduleStatus=processing`,{headers:{cookie}})).status,400);
    assert.equal((await fetch(`${base}/briefings?scheduleStatus=queued&org_id=b`,{headers:{cookie}})).status,400);
    assert.equal((await fetch(`${base}/briefings?scheduleStatus=queued`)).status,401);
    assert.equal(JSON.stringify((await f.exec('SELECT id,state,attempts FROM publication_schedules ORDER BY id')).rows),before);
    if(postgres){await f.exec("UPDATE sessions SET revoked_at=NOW() WHERE principal_id='owner'");assert.equal((await fetch(`${base}/briefings?scheduleStatus=queued`,{headers:{cookie}})).status,401);}
    else {f.db.prepare("UPDATE staff SET active=0 WHERE id='owner'").run();assert.equal((await fetch(`${base}/briefings?scheduleStatus=queued`,{headers:{cookie}})).status,401);}
  }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});

for(const postgres of [false,true]) {
  test(`${postgres?'PostgreSQL':'SQLite'} scheduling persists exact audience, supports cancellation/replays and publishes once after due`,async()=>{
    const f=await fixture(postgres);
    try {
      await f.createBrief('brief');const request=input({publishAt:new Date(Date.now()+5000).toISOString()});
      const created=await f.create(owner,'brief',request);assert.equal(created.state,'queued');assert.equal(created.recipientCount,2);assert.equal(created.version,1);
      assert.equal((await f.exec("SELECT count(*) n FROM publications WHERE org_id='a'")).rows[0].n,0);
      assert.equal(await f.process(),false);
      assert.equal((await f.create(owner,'brief',request)).duplicate,true);
      await assert.rejects(async()=>f.create(owner,'brief',{...request,dueAt:null}),/conflict/);
      await assert.rejects(async()=>f.create(owner,'brief',input({publishAt:request.publishAt})),/already pending/);
      const page=await f.list(owner,'brief');assert.equal(page.total,1);assert.ok(!JSON.stringify(page).includes('snapshot_hash'));assert.ok(!JSON.stringify(page).includes('workerIds'));
      for(const s of [{...owner,role:'auditor',principal_id:'reader'},{...owner,principal_type:'worker'},{...owner,org_id:'b'},{...owner,site_id:'other'},{...owner,token_hash:'f'.repeat(64)}]) await assert.rejects(async()=>f.list(s,'brief'),/Forbidden|Sign in required/);
      const cancel=await f.cancel(owner,'brief',request.requestId);assert.equal(cancel.state,'cancelled');assert.equal((await f.cancel(owner,'brief',request.requestId)).duplicate,true);
      assert.equal((await f.create(owner,'brief',request)).state,'cancelled');
      const replacement=input();await f.create(owner,'brief',replacement);
      await f.exec("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('joiner','a','a','Later joiner','en')");
      await waitUntil(replacement.publishAt);assert.equal(await f.process(),true);assert.equal(await f.process(),false);
      const saved=(await f.list(owner,'brief')).items.find(row=>row.id===replacement.requestId);assert.equal(saved.state,'published');assert.equal(saved.attempts,1);
      const assignments=(await f.exec('SELECT worker_id,language FROM assignments WHERE publication_id=? ORDER BY worker_id',[saved.publicationId])).rows;
      assert.deepEqual(assignments.map(row=>({...row})),[{worker_id:'w1',language:'en'},{worker_id:'w2',language:'ar'}]);
      assert.equal((await f.create(owner,'brief',replacement)).state,'published');await assert.rejects(async()=>f.cancel(owner,'brief',replacement.requestId),/already closed/);
      if(postgres)await assert.rejects(()=>f.exec("UPDATE publication_schedules SET request_json='{}' WHERE id=?",[request.requestId]),/immutable/);
      else assert.throws(()=>f.db.prepare('DELETE FROM publication_schedules WHERE id=?').run(request.requestId),/immutable/);
      assert.equal((await f.exec("SELECT count(*) n FROM audit WHERE action='briefing.schedule_cancelled'")).rows[0].n,1);
    }finally {await f.close();}
  });
  test(`${postgres?'PostgreSQL':'SQLite'} scheduled executor rejects changed version/content/language, revoked authority and expired deadlines`,async()=>{
    const f=await fixture(postgres);
    try {
      const changes=[['revision',"UPDATE briefings SET revision=revision+1 WHERE id='revision'"],['version',"UPDATE briefings SET next_version=next_version+1 WHERE id='version'"],
        ['content',`UPDATE briefings SET prepared_json=NULL WHERE id='content'`],['language',"UPDATE workers SET language='ur' WHERE id='w2'"],
        ['authority',`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='owner'`]];
      for(const [id,sql] of changes) {
        await f.createBrief(id);const request=input();await f.create(owner,id,request);await f.exec(sql);await waitUntil(request.publishAt);
        assert.equal(await f.process(),true);const row=(await f.exec('SELECT * FROM publication_schedules WHERE id=?',[request.requestId])).rows[0];assert.equal(row.state,'failed');assert.equal(row.publication_id,null);assert.ok(row.error);assert.doesNotMatch(row.error,/sentinel|SELECT|JSON/);
        if(id==='language')await f.exec("UPDATE workers SET language='ar' WHERE id='w2'");
        if(id==='authority')await f.exec(`UPDATE staff SET active=${postgres?'true':'1'} WHERE id='owner'`);
      }
      await f.createBrief('cycled');const cycle=input();await f.create(owner,'cycled',cycle);
      await f.exec("UPDATE staff SET role='supervisor' WHERE id='owner'");await f.exec("UPDATE staff SET role='owner' WHERE id='owner'");await waitUntil(cycle.publishAt);await f.process();
      assert.equal((await f.exec('SELECT error FROM publication_schedules WHERE id=?',[cycle.requestId])).rows[0].error,'Publication authority changed');
      await f.createBrief('expired');const expired=input({publishAt:new Date(Date.now()+500).toISOString(),dueAt:new Date(Date.now()+800).toISOString()});await f.create(owner,'expired',expired);await waitUntil(expired.dueAt);await f.process();
      assert.equal((await f.exec('SELECT error FROM publication_schedules WHERE id=?',[expired.requestId])).rows[0].error,'Response deadline passed before publication');
      assert.equal((await f.exec("SELECT count(*) n FROM publications WHERE org_id='a'")).rows[0].n,0);
    }finally {await f.close();}
  });
}
test('schedule boundary validation rejects impossible/ambiguous dates, extra scope, duplicate recipients and unconfirmed cancellation',()=>{
  for(const changes of [{publishAt:'2026-02-30T10:00:00Z'},{publishAt:'2026-10-10T10:00:00'},{dueAt:'2020-01-01T00:00:00Z'},
    {nextVersion:0},{workerIds:['w1','w1']},{org_id:'b'},{state:'published'},{requestId:'bad'}])assert.throws(()=>scheduleInput(input(changes)),/Invalid|Deadline/);
  for(const value of [{confirmed:false},{confirmed:true,workerIds:[]},null])assert.throws(()=>scheduleCancel(value),/Confirm/);
  for(const value of [{page:0},{page:5001},{site_id:'b'},[]])assert.throws(()=>schedulePage(value),/Invalid/);
  assert.deepEqual(scheduleHttpError(Error('Private sentinel')),{status:503,error:'Publication scheduling unavailable. Refresh schedules before retrying.'});
});

for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} schedule HTTP uses scoped credentials/no-store, denies query overrides and preserves cancellation replay`,async()=>{
  const f=await fixture(postgres);await f.createBrief('brief');const password='Disposable scheduler password only';
  if(postgres)await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email:'schedule@example.test',password},{schema:f.options.schema});
  const config={tier:'local',aiMode:'synthetic',accessMode:postgres?'credential':'demo',publicOrigin:origin,schema:f.options.schema,dataClass:'synthetic'};
  const server=postgres?createPostgresRehearsalServer(f.pool,config):createAppServer(f.db,config);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`,url=`${base}/briefings/${postgres?'brief':'shelf'}/schedules`;
  try {
    const login=await fetch(`${base}/${postgres?'auth/staff/login':'demo/session'}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(postgres?{email:'schedule@example.test',password}:{principal:'maya'})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],headers={cookie,origin,'content-type':'application/json'};
    assert.equal((await fetch(url)).status,401);const response=await fetch(url,{headers});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.status,200);
    assert.equal((await fetch(`${url}?org_id=b`,{headers})).status,400);
    const request=input({publishAt:new Date(Date.now()+60000).toISOString(),...(postgres?{}:{revision:1,nextVersion:4,workerIds:['worker-29']})});
    if(!postgres)f.db.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)));
    const accepted=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)});assert.equal(accepted.status,202,await accepted.clone().text());assert.equal((await accepted.json()).state,'queued');
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,origin:'https://foreign.test'},body:JSON.stringify(request)})).status,403);
    assert.equal((await fetch(`${url}?page=1`,{method:'POST',headers,body:JSON.stringify(request)})).status,400);
    const cancel=()=>fetch(`${url}/${request.requestId}/cancel`,{method:'POST',headers,body:JSON.stringify({confirmed:true})});assert.equal((await cancel()).status,200);assert.equal((await (await cancel()).json()).duplicate,true);
    if(postgres){await f.exec("UPDATE sessions SET revoked_at=NOW() WHERE principal_id='owner'");assert.equal((await fetch(url,{headers})).status,401);}
  }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});
