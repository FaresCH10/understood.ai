import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureSettingsSchema} from '../server/settings.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {
  listWorkerNotifications as listLocal,readWorkerNotification as readLocal,workerNotificationReceipt as receiptLocal,
  recordWorkerEvent as recordLocal,staffAuditOnce as auditLocal,savePushSubscription as saveLocal,
  pushSubscriptionStatus as statusLocal,revokePushForSession,processOnePushDelivery as deliverLocal,
  sweepOverdueAssignments as sweepLocal,
} from '../server/notification-events.mjs';
import {
  listWorkerNotifications as listPg,readWorkerNotification as readPg,workerNotificationReceipt as receiptPg,
  recordWorkerEvent as recordPg,staffAuditOnce as auditPg,savePushSubscription as savePg,
  pushSubscriptionStatus as statusPg,revokeSessionPushSubscriptions,processOnePushDelivery as deliverPg,
  sweepOverdueAssignments as sweepPg,
} from '../server/postgres/notification-events.mjs';
import {domainTransaction} from '../server/postgres/domain.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {pushEndpoint,pushSubscriptionInput,pushSubscriptionLimit} from '../server/notification-event-input.mjs';
import {pushCopy} from '../server/push-copy.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {syntheticPushAdapter} from '../server/push-adapter.mjs';
import {requestWorkerDeletion} from '../server/postgres/deletions.mjs';
import {requestWorkerDeletion as requestLocalWorkerDeletion} from '../server/deletions.mjs';

const rawTokenA='A'.repeat(43),rawTokenB='B'.repeat(43);
const tokenA=createHash('sha256').update(rawTokenA).digest('hex');
const tokenB=createHash('sha256').update(rawTokenB).digest('hex');
const endpoint=name=>`https://fcm.googleapis.com/fcm/send/${name}`;
const keys={p256dh:Buffer.alloc(65,7).toString('base64url'),auth:Buffer.alloc(16,9).toString('base64url')};
const subscription=name=>({endpoint:endpoint(name),keys,expirationTime:null});
const workerSession=(id,token_hash)=>token_hash ?? (id==='worker-29'?tokenB:tokenA);
const sessionFor=(id,token_hash)=>({principal_type:'worker',principal_id:id,org_id:'cedar',site_id:'beirut',token_hash:workerSession(id,token_hash),
  access_mode:'credential',credential_revision:1});

async function fixture(postgres) {
  if(!postgres) {
    const db=openDatabase(':memory:');seed(db);ensureSettingsSchema(db);ensureRecordingSchema(db);
    const now=new Date().toISOString(),expires=new Date(Date.now()+30*86400000).toISOString();
    db.prepare('INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode) VALUES(?,?,?,?,?,?,NULL,NULL,?)')
      .run(tokenA,'cedar','beirut','worker','worker-28',expires,'demo');
    db.prepare('INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode) VALUES(?,?,?,?,?,?,NULL,NULL,?)')
      .run(tokenB,'cedar','beirut','worker','worker-29',expires,'demo');
    return {db,options:{},worker:sessionFor,record:input=>recordLocal(db,{now,...input}),
      list:(session,filters)=>listLocal(db,session,filters),read:(session,id)=>readLocal(db,session,id),receipt:(session,id)=>receiptLocal(db,session,id),
      audit:input=>auditLocal(db,{now,...input}),save:(session,input)=>saveLocal(db,session,input),status:(session,adapter)=>statusLocal(db,session,adapter),
      revoke:(session,s)=>revokePushForSession(db,session.token_hash,{now:new Date().toISOString()}),
      deliver:(adapter,now)=>deliverLocal(db,adapter,{now}),sweep:(options={})=>sweepLocal(db,{force:true,now,...options}),
      sql:async(sql,values=[])=>db.prepare(sql).all(...values),exec:async(sql,values=[])=>db.prepare(sql).run(...values),close:()=>db.close()};
  }
  const db=new PGlite(),schema='understood_test_notification_events';
  const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
  await db.exec(`INSERT INTO organizations VALUES('cedar','Cedar'),('harbor','Harbor');
    INSERT INTO sites VALUES('beirut','cedar','Beirut','UTC'),('harbor-yard','harbor','Harbor','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner');
    INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-28','cedar','beirut','W28','en'),('worker-29','cedar','beirut','W29','ar');
    INSERT INTO worker_credentials(worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,password_changed_at)
      VALUES('worker-28','cedar','beirut','w28','active','${'a'.repeat(32)}','${'b'.repeat(128)}',1,clock_timestamp()),
        ('worker-29','cedar','beirut','w29','active','${'a'.repeat(32)}','${'b'.repeat(128)}',1,clock_timestamp());
    INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,access_mode,credential_revision)
      VALUES('${tokenA}','cedar','beirut','worker','worker-28',clock_timestamp()+interval '30 days','credential',1),
        ('${tokenB}','cedar','beirut','worker','worker-29',clock_timestamp()+interval '30 days','credential',1)`);
  const tx=fn=>domainTransaction(pool,schema,fn);
  return {db,pool,schema,worker:sessionFor,record:input=>tx(c=>recordPg(c,{...input})),
    list:(session,filters)=>listPg(pool,session,filters,{schema}),read:(session,id)=>readPg(pool,session,id,{schema}),receipt:(session,id)=>receiptPg(pool,session,id,{schema}),
    audit:input=>tx(c=>auditPg(c,input)),save:(session,input)=>savePg(pool,session,input,{schema}),status:(session,adapter)=>statusPg(pool,session,adapter,{schema}),
    revoke:(session)=>tx(c=>revokeSessionPushSubscriptions(c,session.token_hash,{now:new Date()})),
    deliver:(adapter,now)=>deliverPg(pool,adapter,{schema,now}),sweep:(options={})=>sweepPg(pool,{schema,force:true,...options}),
    sql:async(sql,values=[])=>{let n=0;return (await db.query(sql.replaceAll('?',()=>`$${++n}`),values)).rows;},
    exec:async(sql,values=[])=>{let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),values);},close:()=>db.close()};
}

for(const postgres of [false,true]) test(`${postgres?'PostgreSQL':'SQLite'} worker notification outbox deduplicates, scopes by recipient and stores personal reads`,async()=>{
  const f=await fixture(postgres);
  try {
    const insert=id=>({orgId:'cedar',siteId:'beirut',workerId:'worker-28',kind:'instruction.available',objectType:'assignment',objectId:id,dedupeKey:`instruction.available:${id}`});
    const instructionAt=new Date(Date.now()-60000).toISOString(),deadlineAt=new Date(Date.now()-30000).toISOString();
    assert.equal(await f.record({...insert('assignment-28'),now:instructionAt}),true);
    assert.equal(await f.record({...insert('assignment-28'),now:instructionAt}),false);
    await f.record({...insert('assignment-29'),kind:'deadline.reminder',dedupeKey:'deadline.reminder:assignment-28',objectId:'assignment-28',now:deadlineAt});
    await f.audit({orgId:'cedar',siteId:'beirut',action:'answer.needs_attention',objectId:'private-answer-evidence'});
    const session=f.worker('worker-28');
    const page=await f.list(session,{pageSize:10});
    assert.equal(page.total,2);assert.equal(page.unread,2);assert.deepEqual(page.items.map(item=>item.kind),['deadline.reminder','instruction.available']);
    assert.deepEqual(Object.keys(page.items[0]),['id','kind','label','destination','objectType','objectId','occurredAt','readAt']);
    assert.doesNotMatch(JSON.stringify(page),/private-answer|rubric|answer_text|Worker|worker-28/);
    assert.equal((await f.list(f.worker('worker-29'),{pageSize:10})).total,0);
    const receipt=await f.read(session,page.items[0].id);assert.ok(receipt.readAt);assert.equal((await f.list(session)).unread,1);
    assert.deepEqual(await f.read(session,page.items[0].id),receipt);
    assert.deepEqual(await f.receipt(session,page.items[0].id),{found:true,item:receipt});
    assert.deepEqual(await f.receipt(f.worker('worker-29'),page.items[0].id),{found:false});
    const staffEvent=(await f.sql("SELECT id FROM notification_events WHERE audience='staff'")).at(0);
    assert.ok(staffEvent);
    await assert.rejects(async()=>f.read(session,staffEvent.id),/unavailable/);
    await assert.rejects(async()=>f.list({...session,token_hash:'f'.repeat(64)}),/Sign in required/);
    await f.exec("UPDATE workers SET active=false WHERE id='worker-29'");
    await assert.rejects(async()=>f.list(f.worker('worker-29')),/Sign in required|Forbidden/);
    assert.equal((await f.sql("SELECT count(*) AS n FROM notification_events WHERE kind='instruction.available'"))[0].n,1);
  }finally {await f.close();}
});

test('worker deletion revokes push subscriptions and cancels queued deliveries',async()=>{
  const f=await fixture(true);
  try {
    const session=f.worker('worker-28');
    const saved=await f.save(session,subscription('worker-deletion'));
    assert.equal(await f.record({orgId:'cedar',siteId:'beirut',workerId:'worker-28',kind:'instruction.available',
      objectType:'assignment',objectId:'assignment-delete',dedupeKey:'instruction.available:assignment-delete'}),true);
    assert.equal((await f.sql('SELECT state FROM push_deliveries WHERE subscription_id=?',[saved.id]))[0].state,'queued');
    const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
    await requestWorkerDeletion(f.pool,staff,'worker-28',{requestId:randomUUID(),expectedCode:'W28',reason:'worker_request',confirmed:true},{schema:f.schema});
    const push=await f.sql('SELECT revoked_at,revoke_reason FROM push_subscriptions WHERE id=?',[saved.id]);
    assert.ok(push[0].revoked_at);assert.equal(push[0].revoke_reason,'worker_deleted');
    const delivery=(await f.sql('SELECT state,last_error FROM push_deliveries WHERE subscription_id=?',[saved.id]))[0];
    assert.equal(delivery.state,'cancelled');assert.equal(delivery.last_error,'worker_deleted');
    assert.ok((await f.sql("SELECT revoked_at FROM sessions WHERE principal_id='worker-28'"))[0].revoked_at);
  }finally {await f.close();}
});

test('SQLite worker deletion revokes push subscriptions and cancels queued deliveries',async()=>{
  const f=await fixture(false);
  try {
    const session=f.worker('worker-28');
    const saved=await f.save(session,subscription('worker-local-deletion'));
    assert.equal(await f.record({orgId:'cedar',siteId:'beirut',workerId:'worker-28',kind:'instruction.available',
      objectType:'assignment',objectId:'assignment-delete',dedupeKey:'instruction.available:assignment-delete'}),true);
    assert.equal((await f.sql('SELECT state FROM push_deliveries WHERE subscription_id=?',[saved.id]))[0].state,'queued');
    const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
    requestLocalWorkerDeletion(f.db,staff,'worker-28',{requestId:randomUUID(),expectedCode:'Worker 028',reason:'worker_request',confirmed:true});
    const push=await f.sql('SELECT revoked_at,revoke_reason FROM push_subscriptions WHERE id=?',[saved.id]);
    assert.ok(push[0].revoked_at);assert.equal(push[0].revoke_reason,'worker_deleted');
    const delivery=(await f.sql('SELECT state,last_error FROM push_deliveries WHERE subscription_id=?',[saved.id]))[0];
    assert.equal(delivery.state,'cancelled');assert.equal(delivery.last_error,'worker_deleted');
    assert.ok((await f.sql("SELECT revoked_at FROM sessions WHERE principal_id='worker-28'"))[0].revoked_at);
  }finally {await f.close();}
});

test('lock-screen copy is generic, localized for every worker language, and never carries business content',()=>{
  for(const kind of ['instruction.available','clarification.followup','repeat.available','language.decided','language.approved','language.rejected','deadline.reminder'])
    for(const language of WORKER_LANGUAGE_CODES) {
      const copy=pushCopy(kind,language);assert.ok(copy.title && copy.body);assert.doesNotMatch(`${copy.title} ${copy.body}`,/rubric|shelf|Worker \d|worker-\d|assignment-\d/i,`${kind}/${language}`);
    }
  assert.deepEqual(pushCopy('assignment.overdue','en'),{title:'An assignment is overdue',body:'Open Understood to review it.'});
});

test('push endpoints reject non-allowlisted, credential-bearing and malformed services',()=>{
  for(const value of ['http://fcm.googleapis.com/fcm/send/a','https://evil.example/fcm/send/a','https://user:pass@fcm.googleapis.com/fcm/send/a',
    'https://fcm.googleapis.com/fcm/send/a#fragment'])assert.throws(()=>pushEndpoint(value),/Invalid push subscription|Push service unavailable/);
  assert.equal(pushEndpoint(endpoint('valid')),endpoint('valid'));
  for(const value of [null,{}, {endpoint:endpoint('x'),keys:{}},{endpoint:endpoint('x'),keys:{p256dh:keys.p256dh}},{endpoint:endpoint('x'),keys,extra:true}])
    assert.throws(()=>pushSubscriptionInput(value),/Invalid push subscription/);
});

for(const postgres of [false,true]) test(`${postgres?'PostgreSQL':'SQLite'} push subscriptions bind worker, session and endpoint; reuse by another worker revokes the prior binding`,async()=>{
  const f=await fixture(postgres),first=f.worker('worker-28'),second=f.worker('worker-29',tokenB);
  try {
    const saved=await f.save(first,subscription('shared-device'));
    assert.equal(saved.reused,false);assert.equal(saved.reassigned,false);
    assert.equal((await f.save(first,subscription('shared-device'))).reused,true);
    const status=await f.status(first,{mode:'disabled',publicKey:null});
    assert.equal(status.adapter,'disabled');assert.equal(status.configured,false);assert.equal(status.publicKey,null);assert.equal(status.subscriptions.length,1);
    const reassigned=await f.save(second,subscription('shared-device'));
    assert.equal(reassigned.reassigned,true);
    const rows=await f.sql("SELECT principal_id,revoked_at,revoke_reason FROM push_subscriptions WHERE endpoint LIKE ? ORDER BY principal_id",[endpoint('shared-device')]);
    assert.equal(rows.length,2);assert.equal(rows.find(row=>row.principal_id==='worker-28').revoke_reason,'endpoint_reassigned');
    assert.equal((await f.status(first,{mode:'disabled'})).subscriptions.length,0);
    assert.equal((await f.status(second,{mode:'disabled'})).subscriptions.length,1);
    await f.save(first,subscription('sign-out'));
    assert.equal((await f.revoke(first)),1);
    assert.equal((await f.status(first,{mode:'disabled'})).subscriptions.length,0);
    await assert.rejects(async()=>f.save(first,{...subscription('bad-host'),endpoint:'https://evil.example/push'}),/Push service unavailable/);
  }finally {await f.close();}
});

test('SQLite push delivery records acceptance, endpoint expiry, bounded retries and generic payloads',async()=>{
  const db=openDatabase(':memory:');seed(db);ensureSettingsSchema(db);
  const token=createHash('sha256').update('synthetic-delivery-session').digest('hex');
  db.prepare('INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode) VALUES(?,?,?,?,?,?,NULL,NULL,?)')
    .run(token,'cedar','beirut','worker','worker-27',new Date(Date.now()+30*86400000).toISOString(),'demo');
  const session={principal_type:'worker',principal_id:'worker-27',org_id:'cedar',site_id:'beirut',token_hash:token};
  const now=()=>new Date().toISOString();
  const record=dedupe=>recordLocal(db,{orgId:'cedar',siteId:'beirut',workerId:'worker-27',kind:'instruction.available',
    objectType:'assignment',objectId:dedupe,dedupeKey:dedupe,now:now()});
  const delivery=async(id)=>db.prepare('SELECT * FROM push_deliveries WHERE event_id=?').get(id);
  const eventId=async(dedupe)=>(await db.prepare('SELECT id FROM notification_events WHERE dedupe_key=?').get(dedupe)).id;
  try {
    await saveLocal(db,session,subscription('accepted'));
    assert.equal(await record('accepted-event'),true);
    let captured;
    assert.equal(await deliverLocal(db,{mode:'synthetic',send:async(subscription,payload)=>{captured={subscription,payload};return {accepted:true};}},{now:now()}),true);
    const accepted=await delivery(await eventId('accepted-event'));
    assert.equal(accepted.state,'accepted');assert.equal(accepted.adapter,'synthetic');assert.ok(accepted.accepted_at);
    assert.equal(captured.subscription.endpoint,endpoint('accepted'));
    assert.equal(captured.payload.url,'/#notifications');assert.equal(captured.payload.tag,'understood-instruction.available');
    assert.doesNotMatch(JSON.stringify(captured.payload),/Worker 027|Worker 27|shelf|answer|assignment-/);
    assert.equal(revokePushForSession(db,session.token_hash),1);

    await saveLocal(db,session,subscription('expired'));
    await record('expired-event');
    await deliverLocal(db,{mode:'synthetic',send:async()=>{throw Object.assign(new Error('Gone'),{statusCode:410});}},{now:now()});
    assert.equal((await delivery(await eventId('expired-event'))).state,'expired');
    assert.equal(db.prepare("SELECT revoke_reason FROM push_subscriptions WHERE endpoint=?").get(endpoint('expired')).revoke_reason,'push_expired');

    await saveLocal(db,session,subscription('retry'));
    await record('retry-event');
    const failing={mode:'synthetic',send:async()=>{throw new Error('Synthetic transport unavailable');}};
    for(let attempt=1;attempt<=5;attempt++) {
      db.prepare('UPDATE push_deliveries SET next_attempt_at=? WHERE event_id=?').run(now(),await eventId('retry-event'));
      assert.equal(await deliverLocal(db,failing,{now:new Date(Date.now()+6*3600000).toISOString()}),true);
      const row=await delivery(await eventId('retry-event'));
      if(attempt<5){assert.equal(row.state,'queued');assert.equal(row.attempts,attempt);}
      else {assert.equal(row.state,'uncertain');assert.equal(row.attempts,5);}
    }
    const unsupported=await saveLocal(db,session,subscription('unsupported'));
    assert.ok(unsupported.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE principal_id=? AND revoked_at IS NULL').get('worker-27').n,2);
    assert.ok(pushSubscriptionLimit>=2);
  }finally {db.close();}
});

test('SQLite push HTTP requires a session, labels synthetic delivery, fences origin and unbinds on sign-out',async()=>{
  const db=openDatabase(':memory:'),origin='http://127.0.0.1:3027';
  const server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo',publicOrigin:origin,pushAdapter:syntheticPushAdapter});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const post=(path,body,cookie,headers={})=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(`${base}/push/status`)).status,401);
    assert.equal((await post('/push/subscriptions',subscription('anonymous'))).status,401);
    const login=await post('/demo/session',{principal:'worker-29'});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/push/status?extra=1`,{headers:{cookie}})).status,400);
    assert.deepEqual(await (await fetch(`${base}/push/status`,{headers:{cookie}})).json(),
      {adapter:'synthetic',configured:false,publicKey:null,subscriptions:[]});
    assert.equal((await post('/push/subscriptions',subscription('http'),cookie,{origin:'https://foreign.invalid'})).status,403);
    const saved=await post('/push/subscriptions',subscription('http'),cookie);assert.equal(saved.status,201);
    const first=await saved.json();assert.equal(first.reused,false);assert.match(first.id,/^[a-f0-9-]{36}$/);
    const repeated=await (await post('/push/subscriptions',subscription('http'),cookie)).json();
    assert.equal(repeated.reused,true);assert.equal(repeated.id,first.id);
    const status=await (await fetch(`${base}/push/status`,{headers:{cookie}})).json();
    assert.equal(status.adapter,'synthetic');assert.equal(status.configured,false);assert.equal(status.publicKey,null);
    assert.equal(status.subscriptions.length,1);assert.equal(status.subscriptions[0].id,first.id);
    assert.equal((await fetch(`${base}/push/subscriptions/00000000-0000-4000-8000-000000000000`,{method:'DELETE',headers:{origin,cookie}})).status,404);
    assert.equal((await post('/push/subscriptions?extra=1',subscription('http'),cookie)).status,400);
    assert.equal((await fetch(`${base}/push/subscriptions/${first.id}`,{method:'DELETE',headers:{origin,cookie}})).status,200);
    assert.equal((await (await fetch(`${base}/push/status`,{headers:{cookie}})).json()).subscriptions.length,0);

    const signOut=await post('/push/subscriptions',subscription('sign-out'),cookie);assert.equal(signOut.status,201);
    const context=await (await fetch(`${base}/session`,{headers:{cookie}})).json();
    assert.match(context.clientContext,/^[a-f0-9]{64}$/);
    assert.equal((await post('/logout',{},cookie,{'x-client-session-context':context.clientContext})).status,200);
    assert.equal((await fetch(`${base}/push/status`,{headers:{cookie}})).status,401);
    const row=db.prepare("SELECT revoked_at,revoke_reason FROM push_subscriptions WHERE endpoint=?").get(endpoint('sign-out'));
    assert.ok(row.revoked_at);assert.equal(row.revoke_reason,'signed_out');
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('PostgreSQL push HTTP binds subscriptions to verified worker sessions and reassigns reused endpoints',async()=>{
  const f=await fixture(true),origin='http://127.0.0.1:3028',cookieName='understood_pg_rehearsal';
  const server=createPostgresRehearsalServer(f.pool,{schema:f.schema,dataClass:'synthetic',tier:'local',aiMode:'synthetic',
    accessMode:'credential',publicOrigin:origin,pushAdapter:syntheticPushAdapter});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const cookie=raw=>`${cookieName}=${encodeURIComponent(raw)}`;
  const post=(path,body,raw,headers={})=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...(raw?{cookie:cookie(raw)}:{}),...headers},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(`${base}/push/status`)).status,401);
    const empty=await (await fetch(`${base}/push/status`,{headers:{cookie:cookie(rawTokenA)}})).json();
    assert.equal(empty.adapter,'synthetic',JSON.stringify(empty));assert.equal(empty.configured,false);assert.deepEqual(empty.subscriptions,[]);
    assert.equal((await post('/push/subscriptions',subscription('pg-http'),rawTokenB,{origin:'https://foreign.invalid'})).status,403);
    const saved=await post('/push/subscriptions',subscription('pg-http'),rawTokenA);assert.equal(saved.status,201);
    const own=await saved.json();assert.equal(own.reused,false);
    assert.equal((await (await fetch(`${base}/push/status`,{headers:{cookie:cookie(rawTokenA)}})).json()).subscriptions.length,1);
    assert.deepEqual((await (await fetch(`${base}/push/status`,{headers:{cookie:cookie(rawTokenB)}})).json()).subscriptions,[]);
    const reassigned=await (await post('/push/subscriptions',subscription('pg-http'),rawTokenB)).json();
    assert.equal(reassigned.reassigned,true);
    assert.deepEqual((await (await fetch(`${base}/push/status`,{headers:{cookie:cookie(rawTokenA)}})).json()).subscriptions,[]);
    assert.equal((await (await fetch(`${base}/push/status`,{headers:{cookie:cookie(rawTokenB)}})).json()).subscriptions.length,1);
    const prior=(await f.sql('SELECT revoke_reason FROM push_subscriptions WHERE endpoint=?',[endpoint('pg-http')])).find(row=>row.revoke_reason);
    assert.equal(prior.revoke_reason,'endpoint_reassigned');
    const context=await (await fetch(`${base}/session`,{headers:{cookie:cookie(rawTokenB)}})).json();
    assert.match(context.clientContext,/^[a-f0-9]{64}$/,JSON.stringify(context));
    const signedOut=await post('/logout',{},rawTokenB,{'x-client-session-context':context.clientContext});
    assert.equal(signedOut.status,200,await signedOut.text());
    assert.equal((await fetch(`${base}/push/status`,{headers:{cookie:cookie(rawTokenB)}})).status,401);
    assert.equal((await f.sql('SELECT count(*)::int n FROM push_subscriptions WHERE endpoint=? AND revoke_reason=?',[endpoint('pg-http'),'signed_out']))[0].n,1);
    assert.equal((await f.sql('SELECT count(*)::int n FROM push_subscriptions WHERE endpoint=? AND revoked_at IS NULL',[endpoint('pg-http')]))[0].n,0);
  }finally {await new Promise(resolve=>server.close(resolve));await f.close();}
});

for(const postgres of [false,true]) test(`${postgres?'PostgreSQL':'SQLite'} overdue sweep audits each unsubmitted assignment once and raises one supervisor event`,async()=>{
  const f=await fixture(postgres);
  const past=new Date(Date.now()-3600000).toISOString();
  try {
    if(postgres) {
      await f.exec(`INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES('overdue-brief','cedar','beirut','Shelf','Synthetic','ready','{}')`);
      await f.exec(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state,published_at) VALUES('overdue-pub','cedar','beirut','overdue-brief',1,'{}','published',?)`,[past]);
      await f.exec(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,language) VALUES('overdue-1','cedar','beirut','overdue-pub','worker-28',?,'en')`,[past]);
    } else {
      f.db.prepare('UPDATE assignments SET due_at=? WHERE id=?').run(past,'assignment-29');
    }
    assert.equal(await f.sweep(),1);
    assert.equal(await f.sweep(),0);
    const audits=await f.sql("SELECT id,actor_type,action,object_id FROM audit WHERE action='assignment.overdue'");
    assert.equal(audits.length,1);assert.equal(audits[0].actor_type,'system');
    const events=await f.sql("SELECT kind,object_id FROM notification_events WHERE audience='staff' AND kind='assignment.overdue'");
    assert.equal(events.length,1);assert.equal(events[0].object_id,audits[0].id);
    if(postgres) {
      await f.sweep({limit:50});
      assert.equal((await f.sql("SELECT count(*)::int n FROM audit WHERE action='assignment.overdue'"))[0].n,1);
    }
  }finally {await f.close();}
});
