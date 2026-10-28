import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {processingFilters,listProcessing,getProcessing} from '../server/processing.mjs';
import {createDraft,editDraft,queuePreparation,archiveBriefing} from '../server/preparation.mjs';
import {processOne} from '../server/worker.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {createAppServer} from '../server/index.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
test('processing filters are bounded and reject unknown scope or invalid options',()=>{
  assert.deepEqual(processingFilters(),{search:'',status:'all',kind:'all',sort:'newest',page:1,pageSize:20});
  for(const input of [null,[],{org_id:'cedar'},{search:'x'.repeat(81)},{status:'matched'},{sort:'title'},{page:0},{page:5001},{page:1.5},{pageSize:101},{pageSize:0}]) assert.throws(()=>processingFilters(input),/Invalid processing filter/);
});

test('SQLite processing pages and details are scoped, redact internal errors and fence old/archived retries',()=>{
  const db=openDatabase(':memory:');seed(db);
  try {
    for(let index=0;index<125;index++) {
      const id=`job-${String(index).padStart(3,'0')}`;
      db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,'prepare',?,0,?,NULL,?,?)").run(id,'cedar','beirut','shelf',index+1,index%2 ? 'failed' : 'ready','2026-10-01T00:00:00.000Z','provider-secret https://private.invalid/key','2026-10-01T00:00:00.000Z');
    }
    const first=listProcessing(db,owner,{kind:'prepare',pageSize:100}),last=listProcessing(db,owner,{kind:'prepare',page:2,pageSize:100});
    assert.equal(first.total,125);assert.equal(first.items.length,100);assert.equal(last.items.length,25);
    assert.equal(new Set([...first.items,...last.items].map(row=>row.id)).size,125);
    assert.equal(first.items[0].id,'job-000');assert.equal(listProcessing(db,owner,{status:'failed'}).total,62);
    assert.equal(listProcessing(db,owner,{kind:'prepare',search:'colour'}).total,125);assert.equal(listProcessing(db,owner,{search:'%'}).total,0);
    assert.equal(listProcessing(db,owner).total,149);assert.equal(listProcessing(db,owner,{kind:'answer_check'}).total,24);
    assert.equal(listProcessing(db,owner,{kind:'prepare',page:20}).total,125);assert.deepEqual(listProcessing(db,owner,{page:20}).items,[]);
    assert.ok(!JSON.stringify(first).includes('provider-secret'));assert.ok(!JSON.stringify(last).includes('lease_until'));assert.equal(last.items.every(row=>!row.retryAvailable),true);
    for(const session of [{...owner,role:'supervisor'},{...owner,principal_id:'missing'},{...owner,site_id:'harbor-yard'},{principal_type:'worker'}]) assert.throws(()=>getProcessing(db,session,'job-000'),/Forbidden/);
    const foreign={...owner,principal_id:'harbor-owner',org_id:'harbor',site_id:'harbor-yard'};
    // Discover the seeded foreign staff identity rather than trusting a supplied role.
    foreign.principal_id=db.prepare("SELECT id FROM staff WHERE org_id='harbor'").get().id;
    assert.equal(listProcessing(db,foreign).total,0);assert.throws(()=>getProcessing(db,foreign,'job-000'),/unavailable/);
    const draft=createDraft(db,owner,{requestId:randomUUID(),title:'Retry fixture',source:'This unsupported synthetic instruction must fail safely.'});
    const queued=queuePreparation(db,owner,draft.id,1);while(processOne(db)) {}
    assert.equal(getProcessing(db,owner,queued.id).retryAvailable,true);
    const retry=queuePreparation(db,owner,draft.id,1);assert.equal(retry.id,queued.id);assert.equal(queuePreparation(db,owner,draft.id,1).duplicate,true);
    assert.equal(getProcessing(db,owner,queued.id).retryAvailable,false);
    editDraft(db,owner,draft.id,{revision:1,title:'Retry fixture',source:CANONICAL_SOURCE});
    assert.throws(()=>queuePreparation(db,owner,draft.id,1),/revision changed/);
    assert.equal(getProcessing(db,owner,queued.id).retryAvailable,false);
    const next=queuePreparation(db,owner,draft.id,2);processOne(db);assert.equal(getProcessing(db,owner,next.id).status,'ready');
    archiveBriefing(db,owner,draft.id,{requestId:randomUUID(),revision:2,nextVersion:1,reason:'Close fixture',confirmed:true});
    assert.ok(getProcessing(db,owner,next.id).archived_at);assert.throws(()=>queuePreparation(db,owner,draft.id,2),/archived/);
  } finally {db.close();}
});

test('SQLite processing HTTP lists and details are private and unavailable to workers',async()=>{
  const db=openDatabase(':memory:');seed(db);
  const draft=createDraft(db,owner,{requestId:randomUUID(),title:'HTTP processing fixture',source:CANONICAL_SOURCE});
  const job=queuePreparation(db,owner,draft.id,1),server=sqliteApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const cookieOf=response=>response.headers.get('set-cookie').split(';')[0];
  const session=async principal=>cookieOf(await loginPrincipal(origin, principal));
  try {
    const staff=await session('maya'),worker=await session('worker-30');
    const read=(path,cookie)=>fetch(`${origin}/api${path}`,{headers:cookie ? {cookie} : {}});
    for(const path of ['/processing',`/processing/${job.id}`]) {
      const response=await read(path,staff);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
      assert.equal((await read(path,worker)).status,403);assert.equal((await read(path)).status,401);
    }
    assert.equal((await read('/processing?pageSize=101',staff)).status,400);assert.equal((await read('/processing/not-here',staff)).status,404);
    assert.equal((await (await read(`/processing/${job.id}`,staff)).json()).revision,1);
    const checks=await (await read('/processing?kind=answer_check',staff)).json();assert.equal(checks.total,24);
    const encoded=encodeURIComponent(checks.items[0].id),detail=await read(`/processing/${encoded}`,staff);assert.equal(detail.status,200);
    assert.equal((await detail.json()).id,checks.items[0].id);
    assert.equal((await read(`/processing/${encoded}`,worker)).status,403);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
