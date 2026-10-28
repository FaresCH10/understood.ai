import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {archiveBriefing,copyDraft,editDraft,queuePreparation} from '../server/preparation.mjs';
import {publish,submitAnswer,metrics} from '../server/domain.mjs';
import {requestHelp,ensureClarificationSchema} from '../server/clarifications.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {processOne} from '../server/worker.mjs';
import {createAppServer} from '../server/index.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const maya={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
const input=()=>({requestId:randomUUID(),revision:1,nextVersion:4,reason:'Retire this briefing',confirmed:true});

test('SQLite archive closes new work atomically, preserves evidence, and replays without another audit',()=>{
  const db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);ensureClarificationSchema(db);
  try {
    const request=input(),original=db.prepare("SELECT * FROM briefings WHERE id='shelf'").get();
    const evidence=()=>JSON.stringify(['publications','assignments','attempts','submission_receipts','clarifications'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(({state,...row})=>table==='publications' ? row : {state,...row})));
    const before=evidence();
    for(const patch of [{confirmed:false},{requestId:'bad'},{revision:0},{nextVersion:0},{reason:'x'},{source:'injected'},{org_id:'harbor'}]) assert.throws(()=>archiveBriefing(db,maya,'shelf',{...request,...patch}),/Invalid/);
    for(const session of [{...maya,role:'auditor'},{...maya,role:'supervisor'},{...maya,principal_id:'missing'},{...maya,site_id:'harbor-yard'},worker]) assert.throws(()=>archiveBriefing(db,session,'shelf',request),/Forbidden/);
    assert.throws(()=>archiveBriefing(db,maya,'harbor-brief',request),/unavailable/);
    for(const patch of [{revision:2},{nextVersion:5}]) assert.throws(()=>archiveBriefing(db,maya,'shelf',{...request,...patch}),/revision changed/);
    for(const [table,condition] of [['audit',"WHEN NEW.action='briefing.archived'"],['briefing_archives','']]) {
      db.exec(`CREATE TRIGGER reject_archive BEFORE INSERT ON ${table} ${condition} BEGIN SELECT RAISE(ABORT,'Injected failure'); END`);
      assert.throws(()=>archiveBriefing(db,maya,'shelf',request),/Injected/);
      assert.equal(evidence(),before);assert.deepEqual(db.prepare("SELECT * FROM briefings WHERE id='shelf'").get(),original);
      assert.equal(db.prepare('SELECT count(*) n FROM briefing_archives').get().n,0);db.exec('DROP TRIGGER reject_archive');
    }
    const accepted=archiveBriefing(db,maya,'shelf',request);
    assert.equal(accepted.state,'archived');assert.deepEqual(accepted.closedPublicationIds,['shelf-v3']);assert.equal(accepted.duplicate,false);
    assert.equal(evidence(),before);assert.equal(db.prepare("SELECT state FROM publications WHERE id='shelf-v3'").get().state,'archived');
    assert.deepEqual(metrics(db,'cedar','shelf-v3'),{assigned:30,responses:24,matches:21,clarifications:3,unassessed:0,pending:6,completion:80});
    const auditCount=db.prepare('SELECT count(*) n FROM audit').get().n;
    assert.deepEqual(archiveBriefing(db,maya,'shelf',request),{...accepted,duplicate:true});assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,auditCount);
    for(const patch of [{reason:'Changed reason'},{revision:2},{nextVersion:5}]) assert.throws(()=>archiveBriefing(db,maya,'shelf',{...request,...patch}),/request conflict/);
    const copy=copyDraft(db,maya,'shelf',{requestId:randomUUID(),revision:1,title:'Fresh archived copy',confirmed:true});
    assert.throws(()=>archiveBriefing(db,maya,copy.id,request),/request conflict/);
    assert.throws(()=>archiveBriefing(db,maya,'shelf',{...request,requestId:randomUUID()}),/is archived/);
    assert.throws(()=>editDraft(db,maya,'shelf',{revision:1,title:'Changed shelf',source:original.source}),/is archived/);
    assert.throws(()=>queuePreparation(db,maya,'shelf',1),/is archived/);
    assert.throws(()=>publish(db,maya,'shelf',{requestId:randomUUID(),revision:1,workerIds:['worker-30']}),/is archived/);
    assert.throws(()=>submitAnswer(db,worker,'assignment-30',randomUUID(),'Finished blue; unfinished yellow.'),/unavailable/);
    assert.throws(()=>requestHelp(db,worker,'assignment-30',{requestId:randomUUID(),text:'Need help'}),/unavailable/);
    assert.equal(submitAnswer(db,{...worker,principal_id:'worker-1'},'assignment-1','seed-1','Finished items go on the blue shelf and unfinished items on the yellow shelf.').duplicate,true);
    assert.equal(db.prepare('SELECT prepared_json FROM briefings WHERE id=?').get(copy.id).prepared_json,null);
    assert.throws(()=>db.prepare('UPDATE briefing_archives SET archived_by=?').run('maya'),/immutable/);
    assert.throws(()=>db.prepare('DELETE FROM briefing_archives').run(),/immutable/);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();assert.throws(()=>archiveBriefing(db,maya,'shelf',request),/Forbidden/);
  } finally {db.close();}
});

test('SQLite archive cancels preparation and retains accepted publication replay and prepared artifacts',()=>{
  const db=openDatabase(':memory:');seed(db);
  try {
    const job=queuePreparation(db,maya,'shelf',1),request=input();
    db.prepare("UPDATE jobs SET status='processing',lease_until=? WHERE id=?").run(new Date(Date.now()+60000).toISOString(),job.id);
    archiveBriefing(db,maya,'shelf',request);assert.equal(processOne(db),false);
    assert.equal(db.prepare('SELECT status,error,lease_until FROM jobs WHERE id=?').get(job.id).status,'failed');
    assert.equal(db.prepare("SELECT state FROM briefings WHERE id='shelf'").get().state,'failed');
    const copy=copyDraft(db,maya,'shelf',{requestId:randomUUID(),revision:1,title:'Reused source only',confirmed:true});
    queuePreparation(db,maya,copy.id,1);assert.equal(processOne(db),true);
    const pubRequest={requestId:randomUUID(),revision:1,nextVersion:1,workerIds:['worker-30']},publication=publish(db,maya,copy.id,pubRequest);
    const prepared=db.prepare('SELECT prepared_json FROM briefings WHERE id=?').get(copy.id).prepared_json;
    archiveBriefing(db,maya,copy.id,{...input(),nextVersion:2});
    assert.equal(db.prepare('SELECT prepared_json FROM briefings WHERE id=?').get(copy.id).prepared_json,prepared);
    assert.deepEqual(publish(db,maya,copy.id,pubRequest),{...publication,duplicate:true});
  } finally {db.close();}
});

test('SQLite archive HTTP filters active/history, returns scoped no-store receipts, and denies workers',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>(await loginPrincipal(base, principal)).headers.get('set-cookie').split(';')[0];
  const call=(cookie,path,body,method='POST')=>fetch(base+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined ? undefined : JSON.stringify(body)});
  try {
    const owner=await login('maya'),worker=await login('worker-30'),foreign=await login('harbor-owner'),request=input(),path='/briefings/shelf/archive';
    assert.equal((await call('',path,request)).status,401);assert.equal((await call(worker,path,request)).status,403);assert.equal((await call(foreign,path,request)).status,404);
    assert.equal((await call(owner,path,{...request,confirmed:false})).status,400);assert.equal((await call(owner,path,{...request,nextVersion:5})).status,409);
    const archived=await call(owner,path,request);assert.equal(archived.status,200);assert.match(archived.headers.get('cache-control'),/no-store/);
    assert.equal((await (await call(owner,path,request)).json()).duplicate,true);
    assert.equal((await call(owner,path,{...request,reason:'Different reason'})).status,409);
    const read=async path=>(await call(owner,path,undefined,'GET')).json();
    assert.equal((await read('/briefings')).total,0);
    assert.equal((await read('/briefings?archiveStatus=archived&publicationStatus=archived&status=draft&search=shelf')).total,1);
    assert.equal((await read('/briefings?archiveStatus=all&page=2&pageSize=1')).total,1);
    assert.deepEqual((await read('/briefings?archiveStatus=all&page=2&pageSize=1')).items,[]);
    assert.equal((await read('/briefings/shelf')).archive.reason,request.reason);
    assert.equal((await call(owner,'/briefings?archiveStatus=bad',undefined,'GET')).status,400);
    assert.equal((await call(owner,'/briefings/shelf',{revision:1,title:'Changed',source:'Changed source text'},'PATCH')).status,409);
    assert.equal((await call(owner,'/briefings/shelf/process',{revision:1})).status,409);
    assert.equal((await call(worker,'/worker/briefings/assignment-30',undefined,'GET')).status,200);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
