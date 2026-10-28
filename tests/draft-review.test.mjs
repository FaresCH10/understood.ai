import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase,NOW} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {ensureRecordingSchema} from '../server/recordings.mjs';
import {saveDraftReview,getDraftReview,draftReviewReceipt} from '../server/draft-review.mjs';
import {reviewInput,sameReview,checkedSyntheticReview} from '../server/briefing-input.mjs';
import {syntheticPrepare,CANONICAL_SOURCE,publish} from '../server/domain.mjs';
import {processOne} from '../server/worker.mjs';
import {editDraft} from '../server/preparation.mjs';
import {saveDraftReview as pgSave,draftReviewReceipt as pgReceipt} from '../server/postgres/draft-review.mjs';
import {editDraft as pgEdit,processOnePreparation} from '../server/postgres/preparation.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {getBriefing} from '../server/postgres/read-models.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';

const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const input=(revision=1)=>({requestId:randomUUID(),revision,question:'',facts:[],askedFacts:[],confirmed:true});

test('draft review validation preserves automatic defaults and rejects forged or oversized inputs',()=>{
  for(const patch of [{confirmed:false},{revision:0},{requestId:'bad'},{question:null},{facts:['']},{facts:Array(13).fill('fact')},{askedFacts:['a','a']},{askedFacts:Array(7).fill('a')},{site_id:'foreign'},{prepared:{state:'ready'}}]) assert.throws(()=>reviewInput({...input(),...patch}),/Invalid/);
  const prepared=syntheticPrepare(CANONICAL_SOURCE);
  assert.equal(checkedSyntheticReview(prepared,reviewInput(input())).provenance.reviewRevision,1);
  for(const patch of [{question:'Is the work safe?'},{facts:['Invented source fact']},{askedFacts:['walkway must be clear']}]) assert.throws(()=>checkedSyntheticReview(prepared,{...reviewInput(input()),...patch}),/unsupported/);
  assert.equal(checkedSyntheticReview(prepared,{...reviewInput(input()),question:prepared.question,facts:prepared.facts,askedFacts:prepared.rubric.askedFacts}).question,prepared.question);
});

const translation={title:'تعليمات الرفوف',text:'ضع المكتمل على الرف الأزرق وغير المكتمل على الرف الأصفر.',question:'أين ستضع المنتجات؟'};
test('translated review inputs are bounded and canonical without changing legacy review hashes',()=>{
  const legacy=reviewInput(input()),edited=reviewInput({...input(),translations:{ar:translation}});
  assert.equal('translations' in legacy,false);assert.deepEqual(edited.translations,{ar:translation});
  assert.equal(sameReview(edited,{...edited,translations:{ar:Object.fromEntries(Object.entries(translation).reverse())}}),true);
  assert.equal(sameReview(edited,{...edited,translations:{ar:{...translation,question:'أين الرف؟'}}}),false);
  assert.equal(sameReview(edited,{...edited,translations:undefined}),false);
  for(const translations of [null,[],{en:translation},{ar:{...translation,facts:['private']}},{ar:{...translation,text:''}},{ur:{...translation,question:'wrong language'}}]) assert.throws(()=>reviewInput({...input(),translations}),/Invalid draft review/);
  assert.throws(()=>checkedSyntheticReview(syntheticPrepare(CANONICAL_SOURCE),edited),/unsupported/);
});
async function fixture(pg) {
  if(!pg) {
    const db=openDatabase(':memory:');seed(db);ensureRecordingSchema(db);
    db.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)));
    db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('auditor','cedar','beirut','Auditor','auditor');
    return {db,save:(s,v)=>saveDraftReview(db,s,'shelf',v),get:async()=>({...db.prepare("SELECT * FROM briefings WHERE id='shelf'").get(),review:getDraftReview(db,'shelf','cedar','beirut')}),process:async()=>processOne(db),edit:v=>editDraft(db,owner,'shelf',v),publish:v=>publish(db,owner,'shelf',v),raw:async(sql,v=[])=>({rows:db.prepare(sql).all(...v)}),fail(){db.exec("CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit WHEN NEW.action='briefing.review_updated' BEGIN SELECT RAISE(ABORT,'Injected review failure'); END");},reset(){db.exec('DROP TRIGGER reject_review_audit');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_review'};let fail=false,lost=false;
  const pool={async connect(){return {async query(sql,v){if(fail && sql.includes('INSERT INTO audit')) throw new Error('Injected review failure');const result=v?.length ? await db.query(sql,v) : (await db.exec(sql)).at(-1) || {rows:[]};if(lost && sql==='COMMIT') {lost=false;throw new Error('Lost review commit receipt');}return result;},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.query("INSERT INTO organizations VALUES('cedar','Cedar Works')");await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('auditor','cedar','beirut','Auditor','auditor')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-30','cedar','beirut','Worker 030','ur')");
  const snapshot=JSON.stringify(syntheticPrepare(CANONICAL_SOURCE));
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES('shelf','cedar','beirut','Shelf colour handover',$1,'ready',$2)",[CANONICAL_SOURCE,snapshot]);
  await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('original','cedar','beirut','shelf',1,$1,'published')",[snapshot]);
  return {db,pool,options,save:(s,v)=>pgSave(pool,s,'shelf',v,options),get:()=>getBriefing(pool,owner,'shelf',options),process:async(prepare)=>processOnePreparation(pool,{...options,integrationMode:'synthetic',...(prepare ? {prepare} : {})}),edit:v=>pgEdit(pool,owner,'shelf',v,options),publish:v=>pgPublish(pool,owner,'shelf',v,{...options,integrationMode:'synthetic'}),raw:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},lose(){lost=true;},close:()=>db.close()};
}
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} review saves invalidate readiness, replay once, preserve publication and fail unsupported edits`,async()=>{
  const f=await fixture(pg);
  try {
    const before=JSON.stringify((await f.raw('SELECT snapshot_json,state FROM publications ORDER BY id')).rows),change=input();
    const receipt=(s,id)=>pg ? pgReceipt(f.pool,s,id,f.options) : draftReviewReceipt(f.db,s,id);
    assert.deepEqual(await receipt(owner,randomUUID()),{found:false});await assert.rejects(async()=>receipt(owner,'bad'),/Invalid/);
    for(const s of [{...owner,principal_id:'auditor',role:'auditor'},{...owner,site_id:'foreign'},{...owner,principal_type:'worker'},{...owner,principal_id:'missing'}]) await assert.rejects(async()=>f.save(s,change),/Forbidden/);
    for(const s of [{...owner,principal_id:'auditor',role:'auditor'},{...owner,site_id:'foreign'},{...owner,principal_type:'worker'},{...owner,principal_id:'missing'}]) await assert.rejects(async()=>receipt(s,change.requestId),/Forbidden/);
    f.fail();await assert.rejects(async()=>f.save(owner,change),/Injected/);f.reset();assert.equal((await f.get()).revision,1);assert.equal((await f.raw('SELECT COUNT(*) n FROM briefing_review_requests')).rows[0].n,0);
    if(pg) {f.lose();await assert.rejects(f.save(owner,change),/Lost review/);}else await f.save(owner,change);
    assert.equal((await f.get()).state,'processing');assert.equal((await f.get()).revision,2);
    assert.deepEqual(await receipt(owner,change.requestId),{found:true,id:'shelf',revision:2,request:reviewInput(change)});
    assert.equal((await f.save(owner,change)).duplicate,true);assert.equal((await f.raw('SELECT COUNT(*) n FROM jobs')).rows[0].n,1);
    await assert.rejects(async()=>f.save(owner,{...change,question:'Changed payload'}),/conflict/);await assert.rejects(async()=>f.save(owner,input()),/revision changed/);
    await assert.rejects(async()=>f.publish({requestId:randomUUID(),revision:2,nextVersion:pg?1:4,workerIds:['worker-30']}),/not technically ready/);
    await f.process();assert.equal((await f.get()).state,'ready');
    const bad={...input(2),question:'Is the work safe?'};await f.save(owner,bad);await f.process();assert.equal((await f.get()).state,'failed');
    await assert.rejects(async()=>f.publish({requestId:randomUUID(),revision:3,nextVersion:pg?1:4,workerIds:['worker-30']}),/not technically ready/);
    const repaired=input(3);await f.save(owner,repaired);await f.process();assert.equal((await f.get()).state,'ready');assert.equal((await f.get()).revision,4);
    assert.equal((await f.save(owner,change)).revision,2);assert.equal((await f.get()).revision,4);
    assert.equal((await receipt(owner,change.requestId)).revision,2);
    await f.edit({revision:4,title:'Edited source revision',source:CANONICAL_SOURCE});assert.equal((await f.get()).review,null);assert.equal((await f.get()).state,'draft');
    assert.equal(JSON.stringify((await f.raw('SELECT snapshot_json,state FROM publications ORDER BY id')).rows),before);
    await assert.rejects(f.raw('DELETE FROM briefing_review_requests'),/immutable/);await assert.rejects(f.raw('UPDATE briefing_review_requests SET accepted_revision=99'),/immutable/);
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',...(pg ? {schema:f.options.schema} : {})};
    if(pg) await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'review@example.test',password:'Synthetic-review-password-123'},f.options);
    else seedCredentials(f.db);
    const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie ? {cookie} : {})},body:body ? JSON.stringify(body) : undefined});
    try {
      const login=await call('/auth/staff/login',null,pg ? {email:'review@example.test',password:'Synthetic-review-password-123'} :principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('/briefings/shelf/review',null,input(5))).status,401);
      assert.equal((await call('/briefing-review/receipts/'+change.requestId,null)).status,401);
      const saved=await call('/briefing-review/receipts/'+change.requestId,cookie);assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);assert.equal((await saved.json()).revision,2);
      assert.equal((await call('/briefing-review/receipts/bad',cookie)).status,400);assert.equal((await call('/briefing-review/receipts/'+change.requestId+'?scope=foreign',cookie)).status,400);
      assert.equal((await call('/briefings/shelf/review',cookie,{...input(5),confirmed:false})).status,400);
      assert.equal((await call('/briefings/shelf/review',cookie,input(1))).status,409);
      assert.equal((await call('/briefings/shelf/review?scope=foreign',cookie,input(5))).status,400);
      const next={...input(5),translations:{ar:{...translation,text:'ع'.repeat(5000)},ur:{...translation,text:'ع'.repeat(5000)}}};
      assert.ok(Buffer.byteLength(JSON.stringify(next))>16384);
      const response=await call('/briefings/shelf/review',cookie,next);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
      assert.equal((await (await call('/briefings/shelf/review',cookie,next)).json()).duplicate,true);
      const detail=await (await call('/briefings/shelf',cookie)).json();assert.equal(detail.review.revision,6);
      assert.deepEqual(detail.review.translations,next.translations);
      const replayReceipt=await (await call('/briefing-review/receipts/'+next.requestId,cookie)).json();assert.deepEqual(replayReceipt.request,reviewInput(next));
      assert.equal((await call('/briefings/shelf/review',cookie,{...next,translations:{ar:{...translation,speech:{id:'forged'}}}})).status,400);
      assert.equal((await call('/briefings/shelf/review',cookie,{...next,question:'x'.repeat(100001)})).status,413);
    } finally {await new Promise(resolve=>server.close(resolve));}
    await f.raw(pg ? "UPDATE staff SET active=false WHERE id='maya'" : "UPDATE staff SET active=0 WHERE id='maya'");await assert.rejects(async()=>f.save(owner,change),/Forbidden/);
    await assert.rejects(async()=>receipt(owner,change.requestId),/Forbidden/);
  } finally {await f.close();}
});

for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} translated edits use immutable exact receipts and invalidate readiness without touching publications`,async()=>{
  const f=await fixture(pg);
  try {
    const before=JSON.stringify((await f.raw('SELECT snapshot_json,state FROM publications ORDER BY id')).rows);
    const change={...input(),translations:{ar:translation,ur:{...translation,title:'شیلف کی ہدایات'}}};
    for(const session of [{...owner,principal_id:'auditor'},{...owner,site_id:'foreign'},{...owner,principal_type:'worker'}]) await assert.rejects(async()=>f.save(session,change),/Forbidden/);
    if(pg) {f.lose();await assert.rejects(f.save(owner,change),/Lost review/);}else await f.save(owner,change);
    const draft=await f.get();assert.equal(draft.revision,2);assert.equal(pg ? draft.prepared : draft.prepared_json,null);
    const received=pg ? await pgReceipt(f.pool,owner,change.requestId,f.options) : draftReviewReceipt(f.db,owner,change.requestId);
    assert.deepEqual(received.request,reviewInput(change));
    assert.equal((await f.save(owner,change)).duplicate,true);assert.equal((await f.raw('SELECT COUNT(*) n FROM jobs')).rows[0].n,1);
    await assert.rejects(async()=>f.save(owner,{...change,translations:{ar:{...translation,question:'أين الأصفر؟'}}}),/conflict/);
    assert.deepEqual((await f.get()).review.translations,change.translations);
    await f.process();assert.equal((await f.get()).state,'failed');
    assert.equal(JSON.stringify((await f.raw('SELECT snapshot_json,state FROM publications ORDER BY id')).rows),before);
  }finally {await f.close();}
});
test('PostgreSQL old preparation completion cannot overwrite a newer review revision',async()=>{
  const f=await fixture(true);
  try {
    await f.save(owner,input());await f.process(async source=>{await f.save(owner,input(2));return syntheticPrepare(source);});
    assert.equal((await f.get()).revision,3);assert.equal((await f.get()).state,'processing');
    assert.equal((await f.raw('SELECT status FROM jobs WHERE revision=2')).rows[0].status,'failed');
    await f.process();assert.equal((await f.get()).state,'ready');assert.equal((await f.get()).prepared.provenance.reviewRevision,3);
  } finally {await f.close();}
});
