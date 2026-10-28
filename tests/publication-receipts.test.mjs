import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {CANONICAL_SOURCE,syntheticPrepare,publish as localPublish} from '../server/domain.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {createSchedule as localSchedule,cancelSchedule as localCancel} from '../server/schedules.mjs';
import {createSchedule as pgSchedule,cancelSchedule as pgCancel} from '../server/postgres/schedules.mjs';
import {publicationReceipt as localReceipt} from '../server/publication-receipts.mjs';
import {publicationReceipt as pgReceipt} from '../server/postgres/publication-receipts.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {createSession} from '../server/auth.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {publicationInput,schedulePublicationInput} from '../server/briefing-input.mjs';
import {readPendingPublication,savePendingPublication,clearPendingPublication,checkedPublicationReceipt,checkedPublicationResult} from '../src/publication-recovery.ts';
import {openPrincipalSession} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'},origin='http://127.0.0.1:3020';
const body=()=>({requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['w2','w1'],dueAt:null});
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_publication_receipts';let fail=false;
  const client={async query(sql,args){if(fail && sql.includes('FROM publication_requests'))throw Error('Private receipt SQL sentinel');return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}},options={schema,integrationMode:'synthetic'};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}else {
    seed(db);const prepare=db.prepare.bind(db);db.prepare=sql=>{if(fail && sql.includes('FROM publication_requests'))throw Error('Private receipt SQL sentinel');return prepare(sql);};
  }
  const exec=async(sql,args=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...args)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),args);};
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('other','a','Other','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('reader','a','a','Reader','auditor')");
  await exec("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','W1','en'),('w2','a','a','W2','ar')");
  for(const id of ['brief','scheduled','different'])await exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [id,'a','a','Shelf',CANONICAL_SOURCE,'ready',JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)),new Date().toISOString(),new Date().toISOString()]);
  return {db,pool,options,exec,setFail:v=>{fail=v;},close:()=>db.close(),
    publish:(id,input)=>postgres?pgPublish(pool,owner,id,input,options):localPublish(db,owner,id,input),
    schedule:(input)=>postgres?pgSchedule(pool,owner,'scheduled',input,options):localSchedule(db,owner,'scheduled',input),
    cancel:(id)=>postgres?pgCancel(pool,owner,'scheduled',id,{confirmed:true},options):localCancel(db,owner,'scheduled',id,{confirmed:true}),
    receipt:(s,id,kind,request)=>postgres?pgReceipt(pool,s,id,kind,request,options):localReceipt(db,s,id,kind,request)};
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} publication receipts preserve exact accepted intent, closed schedules and scope without writes`,async()=>{
  const f=await fixture(postgres);
  try {
    const input=body(),pending={briefingId:'brief',kind:'publish',body:input},result=await f.publish('brief',input);
    const schedule={...body(),publishAt:new Date(Date.now()+60000).toISOString(),dueAt:new Date(Date.now()+120000).toISOString(),reminderMinutes:60};
    await f.schedule(schedule);await f.cancel(schedule.requestId);
    const before=JSON.stringify((await f.exec('SELECT id,action,object_id FROM audit ORDER BY id')).rows);
    const receipt=await f.receipt(owner,'brief','publish',input.requestId);assert.equal(receipt.accepted,true);assert.deepEqual(receipt.request,publicationInput(input));assert.equal(checkedPublicationReceipt(receipt,pending).id,result.id);
    assert.deepEqual(Object.keys(receipt).sort(),['accepted','briefingId','kind','request','requestId','result']);
    assert.deepEqual(Object.keys(receipt.result).sort(),['assigned','id','version']);
    const closed=await f.receipt(owner,'scheduled','schedule',schedule.requestId);assert.equal(closed.accepted,true);assert.equal(closed.result.state,'cancelled');assert.deepEqual(closed.request,schedulePublicationInput(schedule));
    assert.equal(checkedPublicationReceipt(closed,{briefingId:'scheduled',kind:'schedule',body:schedule}).state,'cancelled');
    for(const [id,kind,request] of [['brief','publish',randomUUID()],['different','publish',input.requestId],['brief','schedule',input.requestId],['scheduled','publish',schedule.requestId]]) {
      assert.deepEqual(await f.receipt(owner,id,kind,request),{briefingId:id,kind,requestId:request,accepted:false});
    }
    await f.exec("UPDATE briefings SET revision=2,state='draft' WHERE id='brief'");
    await f.exec('INSERT INTO briefing_archives(briefing_id,org_id,site_id,request_id,archived_by,request_json,publication_ids_json,occurred_at) VALUES(?,?,?,?,?,?,?,?)',
      ['brief','a','a',randomUUID(),'owner',JSON.stringify({revision:2,nextVersion:2,reason:'Fixture only'}),'[]',new Date().toISOString()]);
    assert.equal((await f.receipt(owner,'brief','publish',input.requestId)).result.id,result.id);
    for(const actor of [{...owner,principal_type:'worker'},{...owner,role:'auditor',principal_id:'reader'},{...owner,org_id:'b'},{...owner,site_id:'other'},{...owner,token_hash:'f'.repeat(64)}])await assert.rejects(async()=>f.receipt(actor,'brief','publish',input.requestId),/Forbidden|Sign in required/);
    await assert.rejects(async()=>f.receipt(owner,'missing','publish',input.requestId),/Briefing unavailable/);
    for(const [id,kind,request] of [['brief','wrong',input.requestId],['brief','publish','bad'],['x'.repeat(101),'publish',input.requestId]])await assert.rejects(async()=>f.receipt(owner,id,kind,request),/Invalid publication receipt/);
    assert.equal(JSON.stringify((await f.exec('SELECT id,action,object_id FROM audit ORDER BY id')).rows),before);
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='owner'`);await assert.rejects(async()=>f.receipt(owner,'brief','publish',input.requestId),/Forbidden/);
  }finally {await f.close();}
});
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} publication receipt HTTP rejects overrides and revoked authority and sanitizes infrastructure failures`,async()=>{
  const f=await fixture(postgres),config={tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,schema:f.options.schema,dataClass:'synthetic'};
  const password='Disposable receipt password only';
  if(postgres)for(const staffId of ['owner','reader'])await provisionStaffCredential(f.pool,{staffId,orgId:'a',siteId:'a',email:`${staffId}@example.test`,password},{schema:f.options.schema});
  const server=postgres?createPostgresRehearsalServer(f.pool,config):createAppServer(f.db,config);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async staffId=>{
    if(!postgres)return `understood_session=${openPrincipalSession(f.db,f.db.prepare('SELECT * FROM staff WHERE id=?').get(staffId)).token}`;
    const r=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:`${staffId}@example.test`,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
  };
  try {
    const cookie=await login('owner'),reader=await login('reader'),input=body();await f.publish('brief',input);
    const path=`${base}/briefings/brief/publication-receipts/publish/${input.requestId}`;
    const read=await fetch(path,{headers:{cookie}});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal((await read.json()).accepted,true);
    assert.equal((await fetch(path+'?org_id=b',{headers:{cookie}})).status,400);
    assert.equal((await fetch(path.replace('publish/','wrong/'),{headers:{cookie}})).status,400);
    assert.equal((await fetch(path,{headers:{cookie:reader}})).status,403);assert.equal((await fetch(path)).status,401);
    f.setFail(true);const failed=await fetch(path,{headers:{cookie}});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('sentinel'));f.setFail(false);
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='owner'`);assert.equal((await fetch(path,{headers:{cookie}})).status,401);
  }finally {await new Promise(r=>server.close(r));await f.close();}
});
test('publication tab recovery validates bounded storage, exact acknowledgements and identity isolation',()=>{
  const rows=new Map(),storage={getItem:k=>rows.get(k) ?? null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  const pending={briefingId:'brief',kind:'publish',body:body()};savePendingPublication(storage,'one',pending);assert.deepEqual(readPendingPublication(storage,'one'),pending);assert.equal(readPendingPublication(storage,'other'),null);
  for(const patch of [{briefingId:'other'},{kind:'schedule'},{body:{...pending.body,nextVersion:2}},{body:{...pending.body,requestId:randomUUID()}},{body:{...pending.body,workerIds:['w1']}}])assert.throws(()=>savePendingPublication(storage,'one',{...pending,...patch}));
  assert.throws(()=>savePendingPublication({getItem:()=>null,setItem(){},removeItem(){}},'one',pending),/No request was sent/);
  assert.throws(()=>readPendingPublication({getItem(){throw Error();}},'one'),/unavailable/);
  const result={id:randomUUID(),version:1,assigned:2},receipt={accepted:true,requestId:pending.body.requestId,briefingId:'brief',kind:'publish',request:publicationInput(pending.body),result};
  assert.deepEqual(checkedPublicationReceipt(receipt,pending),result);assert.equal(checkedPublicationReceipt({accepted:false,requestId:pending.body.requestId,briefingId:'brief',kind:'publish'},pending),null);
  assert.throws(()=>checkedPublicationReceipt({...receipt,accepted:false},pending),/match/);
  for(const patch of [{requestId:randomUUID()},{briefingId:'other'},{kind:'schedule'},{accepted:'true'},{request:{...receipt.request,nextVersion:2}},{request:{...receipt.request,workerIds:['w1']}},{result:{...result,assigned:1}}])assert.throws(()=>checkedPublicationReceipt({...receipt,...patch},pending),/match/);
  for(const patch of [{id:''},{version:2},{assigned:3}])assert.throws(()=>checkedPublicationResult({...result,...patch},pending),/match/);
  assert.throws(()=>clearPendingPublication(storage,'one',{...pending,body:{...pending.body,requestId:randomUUID()}}),/changed/);clearPendingPublication(storage,'one',pending);assert.equal(readPendingPublication(storage,'one'),null);
  for(const raw of ['{}','[]','null','x'.repeat(600001),JSON.stringify({...pending,secret:'invalid'})]){rows.set('understood:publication:one',raw);assert.throws(()=>readPendingPublication(storage,'one'),/cannot be verified/);}
});
