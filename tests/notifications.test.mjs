import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {listNotifications,readNotification,notificationReceipt} from '../server/notifications.mjs';
import * as pg from '../server/postgres/notifications.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {notificationFilters,notificationId,notificationKinds} from '../server/notification-input.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';

const fetch=createSessionContextFetch();

const owner={principal_type:'staff',principal_id:'maya',role:'owner',org_id:'cedar',site_id:'beirut'};
const origin='http://127.0.0.1:3020';
async function fixture(postgres) {
  if(!postgres) {
    const db=openDatabase(':memory:');seed(db);
    db.prepare("INSERT INTO staff VALUES('reader','cedar','beirut','Reader','auditor',1)").run();
    db.prepare("INSERT INTO sites VALUES('tripoli','cedar','Tripoli','UTC')").run();
    return {db,list:(session,filters)=>listNotifications(db,session,filters),read:(session,id)=>readNotification(db,session,id),receipt:(session,id)=>notificationReceipt(db,session,id),
      sql:async(sql,values=[])=>db.prepare(sql).all(...values),exec:async(sql,values=[])=>db.prepare(sql).run(...values),close:()=>db.close()};
  }
  const db=new PGlite(),schema='understood_test_notifications';let failure=false,loseCommit=false;
  const client={async query(sql,values){if(failure && sql.startsWith('INSERT INTO notification_reads'))throw Error('Injected receipt failure');const result=values?.length?await db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};if(loseCommit && sql==='COMMIT'){loseCommit=false;throw Error('Commit acknowledgement lost');}return result;},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec("INSERT INTO organizations VALUES('cedar','Cedar'),('harbor','Harbor'); INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('tripoli','cedar','Tripoli','UTC'),('harbor-yard','harbor','Harbor','UTC'); INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('reader','cedar','beirut','Reader','auditor');");
  return {db,pool,schema,list:(session,filters)=>pg.listNotifications(pool,session,filters,{schema}),read:(session,id)=>pg.readNotification(pool,session,id,{schema}),receipt:(session,id)=>pg.notificationReceipt(pool,session,id,{schema}),
    sql:async(sql,values=[])=>{let n=0;return (await db.query(sql.replaceAll('?',()=>`$${++n}`),values)).rows;},
    exec:async(sql,values=[])=>{let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);},setFail:value=>{failure=value;},loseNextCommit:()=>{loseCommit=true;},close:()=>db.close()};
}
async function event(f,id,action,time,org='cedar',site='beirut') {
  await f.exec('INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)',[id,org,site,'system','pipeline',action,'private-worker-and-transcript',time]);
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} notifications minimize metadata, persist personal exact reads, bound history and reject foreign authority`,async()=>{
  const f=await fixture(postgres),now=new Date(Date.now()-1000).toISOString(),reader={...owner,principal_id:'reader',role:'auditor'};
  try {
    await event(f,'notice-a','briefing.prepared',now);await event(f,'notice-b','help.requested',now);
    await event(f,'foreign','export.ready',now,'harbor','harbor-yard');await event(f,'other-site','export.ready',now,'cedar','tripoli');
    await event(f,'old','briefing.published',new Date(Date.now()-91*86400000).toISOString());
    await event(f,'future','briefing.published',new Date(Date.now()+86400000).toISOString());
    await event(f,'secret-event','private.credential',now);
    const result=await f.list(owner,{pageSize:1});assert.equal(result.total,2);assert.equal(result.unread,2);assert.equal(result.items[0].id,'notice-b');
    assert.equal((await f.list(owner,{pageSize:1,page:2})).items[0].id,'notice-a');
    assert.deepEqual(Object.keys(result.items[0]),['id','kind','label','subject','destination','occurredAt','readAt']);
    assert.equal(result.items[0].subject,null);
    assert.doesNotMatch(JSON.stringify(result),/private-worker|pipeline|credential|token|rubric|transcript|actor/);
    assert.equal((await f.sql('SELECT * FROM notification_reads')).length,0);
    const receipt=await f.read(owner,'notice-b');assert.ok(receipt.readAt);assert.deepEqual(await f.read(owner,'notice-b'),receipt);
    const beforeLookup=await f.sql('SELECT * FROM notification_reads ORDER BY event_id,staff_id');
    assert.deepEqual(await f.receipt(owner,'notice-b'),{found:true,item:receipt});assert.deepEqual(await f.receipt(reader,'notice-b'),{found:false});
    assert.deepEqual(await f.receipt(owner,'notice-a'),{found:false});assert.deepEqual(await f.receipt(owner,'foreign'),{found:false});
    assert.deepEqual(await f.sql('SELECT * FROM notification_reads ORDER BY event_id,staff_id'),beforeLookup);
    assert.equal((await f.list(owner,{status:'unread'})).total,1);assert.equal((await f.list(reader,{status:'unread'})).total,2);
    const ownReader=await f.read(reader,'notice-b');assert.equal(ownReader.id,receipt.id);assert.equal((await f.sql('SELECT * FROM notification_reads')).length,2);
    for(const id of ['foreign','other-site','old','future','secret-event','missing'])await assert.rejects(async()=>f.read(owner,id),/unavailable/);
    for(const session of [{...owner,principal_type:'worker'},{...owner,role:'administrator'},{...owner,site_id:'tripoli'},{...owner,org_id:'harbor'},{...owner,token_hash:'f'.repeat(64)}]){
      await assert.rejects(async()=>f.list(session),/Forbidden|Sign in required/);await assert.rejects(async()=>f.read(session,'notice-a'),/Forbidden|Sign in required/);
      await assert.rejects(async()=>f.receipt(session,'notice-b'),/Forbidden|Sign in required/);
    }
    await assert.rejects(async()=>f.exec("INSERT INTO notification_reads VALUES('notice-a','reader','harbor','harbor-yard',?)",[now]),/Scope mismatch|foreign key/);
    await assert.rejects(async()=>f.exec("UPDATE notification_reads SET read_at=?",[now]),/immutable/);
    await assert.rejects(async()=>f.exec('DELETE FROM notification_reads'),/immutable/);
    if(postgres){f.setFail(true);await assert.rejects(f.read(owner,'notice-a'),/Injected/);f.setFail(false);assert.equal((await f.list(owner,{status:'unread'})).total,1);f.loseNextCommit();await assert.rejects(f.read(owner,'notice-a'),/acknowledgement lost/);const committed=(await f.list(owner)).items.find(item=>item.id==='notice-a');assert.ok(committed.readAt);assert.deepEqual(await f.read(owner,'notice-a'),committed);}
    else {await f.exec("CREATE TRIGGER receipt_denied BEFORE INSERT ON notification_reads BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END");await assert.rejects(async()=>f.read(owner,'notice-a'),/Injected/);await f.exec('DROP TRIGGER receipt_denied');assert.equal((await f.list(owner,{status:'unread'})).total,1);}
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='maya'`);await assert.rejects(async()=>f.list(owner),/Forbidden/);
  }finally {await f.close();}
});
test('notification input rejects unknown scope, arbitrary IDs and unbounded pagination',()=>{
  for(const input of [null,[],{org_id:'harbor'},{status:'read'},{page:0},{pageSize:51},{page:5001}])assert.throws(()=>notificationFilters(input),/Invalid/);
  for(const id of ['',null,'/foreign','x'.repeat(101)])assert.throws(()=>notificationId(id),/Invalid/);
  assert.deepEqual(Object.keys(notificationKinds).sort(),[
    'briefing.prepared','briefing.published','briefing.withdrawn','help.requested',
    'clarification.assigned','clarification.routed','clarification.escalated','clarification.resolved','clarification.message',
    'worker.language_requested','answer.needs_attention','instruction.send_incomplete','assignment.overdue','export.ready','export.failed',
  ].sort());
});

for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} exact personal read receipt remains readable after its event leaves recent history`,async context=>{
  const f=await fixture(postgres);
  try{
    await event(f,'window-recovery','briefing.prepared',new Date(Date.now()-1000).toISOString());
    const accepted=await f.read(owner,'window-recovery');
    context.mock.timers.enable({apis:['Date'],now:Date.now()+91*86400000});
    assert.equal((await f.list(owner)).items.some(item=>item.id==='window-recovery'),false);
    assert.deepEqual(await f.receipt(owner,'window-recovery'),{found:true,item:accepted});
    assert.deepEqual(await f.receipt({...owner,principal_id:'reader',role:'auditor'},'window-recovery'),{found:false});
    await assert.rejects(async()=>f.read(owner,'window-recovery'),/unavailable/);
    assert.deepEqual(await f.receipt(owner,'window-recovery'),{found:true,item:accepted});
  }finally{context.mock.timers.reset();await f.close();}
});
test('PostgreSQL credential notification HTTP scopes metadata and read receipts, rejects forgery and hides internal failure',async()=>{
  const f=await fixture(true),password='Synthetic notification password only';
  const server=createPostgresRehearsalServer(f.pool,{schema:f.schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin});
  await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'notice@example.test',password},{schema:f.schema});
  await event(f,'http-pg-notice','briefing.prepared',new Date(Date.now()-1000).toISOString());
  await event(f,'foreign-pg','export.ready',new Date(Date.now()-1000).toISOString(),'harbor','harbor-yard');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const post=(body,cookie)=>({method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  try {
    const signed=await fetch(`${base}/auth/staff/login`,post({email:'notice@example.test',password}));assert.equal(signed.status,200);const cookie=signed.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/notifications`)).status,401);
    assert.equal((await fetch(`${base}/notifications?staff_id=reader`,{headers:{cookie}})).status,400);
    assert.equal((await fetch(`${base}/notifications/foreign-pg/read`,post({},cookie))).status,404);
    assert.equal((await fetch(`${base}/notifications/http-pg-notice/read`,post({org_id:'harbor'},cookie))).status,400);
    assert.equal((await fetch(`${base}/notifications/http-pg-notice/read`,{...post({},cookie),headers:{cookie,origin:'https://foreign.invalid','content-type':'application/json'}})).status,403);
    f.setFail(true);const failed=await fetch(`${base}/notifications/http-pg-notice/read`,post({},cookie));assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/Injected/);f.setFail(false);
    const accepted=await fetch(`${base}/notifications/http-pg-notice/read`,post({},cookie));assert.equal(accepted.status,200);const receipt=await accepted.json();
    assert.deepEqual(await (await fetch(`${base}/notifications/http-pg-notice/read`,post({},cookie))).json(),receipt);
    const saved=await fetch(`${base}/notifications/http-pg-notice/receipt`,{headers:{cookie}});assert.equal(saved.headers.get('cache-control'),'no-store');assert.deepEqual(await saved.json(),{found:true,item:receipt});
    assert.equal((await fetch(`${base}/notifications/http-pg-notice/receipt?staff_id=reader`,{headers:{cookie}})).status,400);
    const list=await fetch(`${base}/notifications`,{headers:{cookie}});assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).unread,0);
    await f.exec("UPDATE staff SET active=false WHERE id='maya'");assert.equal((await fetch(`${base}/notifications`,{headers:{cookie}})).status,401);
  }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});
test('SQLite notification HTTP reauthorizes, requires local origin, keeps reads no-store and rejects forged writes',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db,{publicOrigin:origin});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>(await loginPrincipal(base, principal, origin)).headers.get('set-cookie').split(';')[0];
  const request=(cookie,path,body,headers={})=>fetch(base+path,{headers:{...(cookie?{cookie}:{}),...headers,...(body===undefined?{}:{origin,'content-type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  try {
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run('http-notice','cedar','beirut','system','pipeline','export.ready','private',new Date(Date.now()-1000).toISOString());
    const staff=await login('maya'),worker=await login('worker-29'),other=await login('harbor-owner');
    assert.equal((await request(null,'/notifications')).status,401);
    assert.deepEqual(await (await request(worker,'/notifications')).json().then(body=>({total:body.total,items:body.items})),{total:0,items:[]});
    assert.equal((await request(worker,'/notifications/http-notice/read',{})).status,404);
    assert.equal((await request(other,'/notifications/http-notice/read',{})).status,404);
    assert.equal((await request(staff,'/notifications?org_id=harbor')).status,400);
    assert.equal((await request(staff,'/notifications/http-notice/read',{staffId:'reader'})).status,400);
    assert.equal((await fetch(`${base}/notifications/http-notice/read`,{method:'POST',headers:{cookie:staff,origin:'https://foreign.invalid','content-type':'application/json'},body:'{}'})).status,403);
    const list=await request(staff,'/notifications');assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).unread,1);
    const accepted=await request(staff,'/notifications/http-notice/read',{});assert.equal(accepted.status,200);const receipt=await accepted.json();
    assert.deepEqual(await (await request(staff,'/notifications/http-notice/read',{})).json(),receipt);
    assert.deepEqual(await (await request(staff,'/notifications/http-notice/receipt')).json(),{found:true,item:receipt});
    assert.deepEqual(await (await request(other,'/notifications/http-notice/receipt')).json(),{found:false});
    assert.deepEqual(await (await request(worker,'/notifications/http-notice/receipt')).json(),{found:false});
    assert.equal((await request(staff,'/notifications/http-notice/receipt?scope=foreign')).status,400);
    assert.equal((await (await request(staff,'/notifications?status=unread')).json()).total,0);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();assert.equal((await request(staff,'/notifications')).status,401);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
