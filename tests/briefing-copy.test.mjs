import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {copyDraft,editDraft,createDraft} from '../server/preparation.mjs';
import {createAppServer} from '../server/index.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const maya={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const input=()=>({requestId:randomUUID(),revision:1,title:'Copied shelf handover',confirmed:true});

test('SQLite draft copy has immutable replay, no inherited readiness and preserved original evidence',()=>{
  const db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);
  try {
    const original=db.prepare("SELECT * FROM briefings WHERE id='shelf'").get();
    const evidence=()=>JSON.stringify(['publications','assignments','attempts','submission_receipts','clarifications'].map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
    const before=evidence(),request=input();
    for(const patch of [{confirmed:false},{requestId:'bad'},{revision:0},{title:'x'},{source:'injected'},{state:'ready'},{org_id:'harbor'}]) assert.throws(()=>copyDraft(db,maya,'shelf',{...request,...patch}),/Invalid/);
    for(const session of [{...maya,role:'auditor'},{...maya,role:'supervisor'},{...maya,principal_id:'missing'},{...maya,site_id:'harbor-yard'},{...maya,principal_type:'worker'}]) assert.throws(()=>copyDraft(db,session,'shelf',request),/Forbidden/);
    assert.throws(()=>copyDraft(db,maya,'harbor-brief',request),/unavailable/);
    assert.throws(()=>copyDraft(db,maya,'shelf',{...request,revision:2}),/revision changed/);
    db.exec("CREATE TRIGGER reject_copy_audit BEFORE INSERT ON audit WHEN NEW.action='briefing.copied' BEGIN SELECT RAISE(ABORT,'Injected audit failure'); END");
    assert.throws(()=>copyDraft(db,maya,'shelf',request),/Injected/);
    assert.equal(db.prepare('SELECT id FROM briefings WHERE id=?').get(request.requestId),undefined);
    assert.equal(db.prepare('SELECT count(*) n FROM briefing_copies').get().n,0);
    db.exec('DROP TRIGGER reject_copy_audit');
    db.exec("CREATE TRIGGER reject_copy_receipt BEFORE INSERT ON briefing_copies BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END");
    assert.throws(()=>copyDraft(db,maya,'shelf',request),/Injected/);
    assert.equal(db.prepare('SELECT id FROM briefings WHERE id=?').get(request.requestId),undefined);
    db.exec('DROP TRIGGER reject_copy_receipt');
    assert.deepEqual(copyDraft(db,maya,'shelf',request),{id:request.requestId,state:'draft',revision:1,duplicate:false});
    const copy=db.prepare('SELECT * FROM briefings WHERE id=?').get(request.requestId);
    assert.equal(copy.source,original.source);assert.equal(copy.title,request.title);assert.equal(copy.prepared_json,null);assert.equal(copy.next_version,1);
    assert.equal(db.prepare('SELECT count(*) n FROM jobs WHERE briefing_id=?').get(copy.id).n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM publications WHERE briefing_id=?').get(copy.id).n,0);
    assert.deepEqual(db.prepare("SELECT * FROM briefings WHERE id='shelf'").get(),original);assert.equal(evidence(),before);
    editDraft(db,maya,copy.id,{revision:1,title:'Changed copy',source:'Changed source content for the new draft.'});
    editDraft(db,maya,'shelf',{revision:1,title:'Changed original',source:'Original source changed after creating a copy.'});
    const auditCount=db.prepare('SELECT count(*) n FROM audit').get().n;
    assert.equal(copyDraft(db,maya,'shelf',request).duplicate,true);assert.equal(copyDraft(db,maya,'shelf',request).revision,2);
    assert.equal(db.prepare('SELECT title FROM briefings WHERE id=?').get(copy.id).title,'Changed copy');
    assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,auditCount);
    for(const patch of [{title:'Other title'},{revision:2}]) assert.throws(()=>copyDraft(db,maya,'shelf',{...request,...patch}),/request conflict/);
    assert.throws(()=>copyDraft(db,maya,copy.id,request),/request conflict/);
    assert.throws(()=>db.prepare('UPDATE briefing_copies SET title=?').run('Different title'),/immutable/);
    assert.throws(()=>db.prepare('DELETE FROM briefing_copies').run(),/immutable/);
    const existing=createDraft(db,maya,{requestId:randomUUID(),title:'Existing draft',source:'Existing source text for collision.'});
    assert.throws(()=>copyDraft(db,maya,'shelf',{...input(),revision:2,requestId:existing.id}),/request conflict/);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();assert.throws(()=>copyDraft(db,maya,'shelf',request),/Forbidden/);
  } finally {db.close();}
});

test('SQLite draft copy HTTP rejects forged input and returns scoped no-store replay',async()=>{
  const db=openDatabase(':memory:'),server=sqliteApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>(await loginPrincipal(base, principal)).headers.get('set-cookie').split(';')[0];
  const call=(cookie,id,body)=>fetch(`${base}/briefings/${id}/copy`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    const owner=await login('maya'),worker=await login('worker-29'),foreign=await login('harbor-owner'),request=input();
    assert.equal((await call('', 'shelf',request)).status,401);assert.equal((await call(worker,'shelf',request)).status,403);
    assert.equal((await call(foreign,'shelf',request)).status,404);assert.equal((await call(owner,'shelf',{...request,confirmed:false})).status,400);
    assert.equal((await call(owner,'shelf',{...request,revision:2})).status,409);
    const first=await call(owner,'shelf',request);assert.equal(first.status,201);assert.match(first.headers.get('cache-control'),/no-store/);
    assert.equal((await (await call(owner,'shelf',request)).json()).duplicate,true);
    assert.equal((await call(owner,'shelf',{...request,title:'Different title'})).status,409);
    assert.equal(db.prepare('SELECT count(*) n FROM assignments').get().n,30);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
