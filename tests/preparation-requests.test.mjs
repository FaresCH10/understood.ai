import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import * as sqlite from '../server/preparation.mjs';
import * as postgres from '../server/postgres/preparation.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {processOne} from '../server/worker.mjs';
import {preparationRequestInput,preparationRequestReceipt} from '../server/preparation-request-input.mjs';
import {createAppServer} from '../server/index.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {sqliteApp,principalLoginBody} from './helpers/sqlite-app.mjs';

const contextualFetch=createSessionContextFetch();
const source='This unsupported synthetic instruction must fail safely.';
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
async function fixture(mode) {
  if(mode==='sqlite') {
    const db=openDatabase(':memory:');seed(db);db.prepare("INSERT INTO staff VALUES('other','cedar','beirut','Other','supervisor',1)").run();
    return {db,api:sqlite,actor:owner,run:()=>{while(processOne(db)){}},query:(sql,args=[])=>db.prepare(sql.replace(/\$\d+/g,'?')).all(...args),close:()=>db.close()};
  }
  const db=new PGlite(),pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release(){}};}};
  await runMigrations(pool);await db.exec(`INSERT INTO organizations VALUES('cedar','Synthetic');INSERT INTO sites VALUES('beirut','cedar','Synthetic','UTC');
    INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Owner','owner'),('other','cedar','beirut','Other','supervisor');`);
  return {db:pool,api:postgres,actor:owner,run:()=>postgres.processOnePreparation(pool,{integrationMode:'synthetic'}),query:async(sql,args=[])=> (await db.query(sql,args)).rows,close:()=>db.close()};
}
test('preparation request contract is exact, bounded and refuses inconsistent receipt metadata',()=>{
  const body={requestId:randomUUID(),revision:1,jobId:null,generation:0};
  assert.equal(preparationRequestInput('draft',body).briefingId,'draft');
  for(const value of [null,[],{...body,requestId:'bad'},{...body,scope:'foreign'},{...body,revision:0},{...body,generation:1},{...body,jobId:'x',generation:-1},{...body,jobId:'x',generation:1000001}])
    assert.throws(()=>preparationRequestInput('draft',value),/Invalid preparation/);
  assert.throws(()=>preparationRequestReceipt({briefing_id:'draft',request_id:body.requestId,request_json:{revision:1,jobId:null,generation:0},revision:2,generation:0,job_id:'job',created_at:new Date().toISOString()}),/receipt invalid/);
});
for(const mode of ['sqlite','postgres'])test(`${mode} preparation receipts survive failure, revision changes and archive without requeueing or crossing actors`,async()=>{
  const f=await fixture(mode),{db,api,actor}=f;
  try {
    const draft=await api.createDraft(db,actor,{requestId:randomUUID(),title:'Receipt fixture',source});
    const initial={requestId:randomUUID(),revision:1,jobId:null,generation:0};
    assert.deepEqual(await api.getPreparationRequestContext(db,actor,draft.id),{briefingId:draft.id,revision:1,state:'draft',job:null});
    const accepted=await api.requestPreparation(db,actor,draft.id,initial);
    const receipt=await api.getPreparationRequestReceipt(db,actor,draft.id,initial.requestId);
    assert.deepEqual(receipt.request,{requestId:initial.requestId,briefingId:draft.id,revision:1,jobId:null,generation:0});
    assert.deepEqual(receipt.result,{id:accepted.id,state:'processing',acceptedAt:accepted.acceptedAt});
    await assert.rejects(async()=>f.query('UPDATE preparation_requests SET generation=999 WHERE request_id=$1',[initial.requestId]),/immutable/);
    await assert.rejects(async()=>f.query('DELETE FROM preparation_requests WHERE request_id=$1',[initial.requestId]),/immutable/);
    const audits=()=>f.query("SELECT * FROM audit WHERE action='briefing.processing_requested'");
    assert.equal((await audits()).length,1);
    assert.deepEqual(await api.requestPreparation(db,actor,draft.id,initial),{...receipt.result,duplicate:true});
    await f.run();assert.equal((await api.getPreparationRequestContext(db,actor,draft.id)).state,'failed');
    await api.requestPreparation(db,actor,draft.id,initial);
    assert.equal((await api.getPreparationRequestContext(db,actor,draft.id)).state,'failed');
    assert.equal((await audits()).length,1);
    const retry={requestId:randomUUID(),revision:1,jobId:accepted.id,generation:1};
    const next=await api.requestPreparation(db,actor,draft.id,retry);assert.equal(next.id,accepted.id);
    await f.run();assert.equal((await api.getPreparationRequestContext(db,actor,draft.id)).job.generation,2);
    await assert.rejects(async()=>api.requestPreparation(db,actor,draft.id,{...retry,requestId:randomUUID()}),/state changed/);
    await api.requestPreparation(db,actor,draft.id,retry);assert.equal((await audits()).length,2);
    await assert.rejects(async()=>api.requestPreparation(db,actor,draft.id,{...initial,revision:2}),/conflict/);
    const other=(await f.query("SELECT id FROM staff WHERE org_id='cedar' AND site_id='beirut' AND id<>'maya' LIMIT 1"))[0];
    const otherRole=(await f.query('SELECT role FROM staff WHERE id=$1',[other.id]))[0].role;
    const different={...actor,principal_id:other.id,role:otherRole};
    assert.deepEqual(await api.getPreparationRequestReceipt(db,different,draft.id,initial.requestId),{found:false});
    await assert.rejects(async()=>api.requestPreparation(db,different,draft.id,initial),/conflict/);
    await assert.rejects(async()=>api.getPreparationRequestReceipt(db,{...actor,principal_type:'worker'},draft.id,initial.requestId),/Forbidden/);
    await api.editDraft(db,actor,draft.id,{revision:1,title:'Receipt fixture edited',source});
    assert.deepEqual(await api.getPreparationRequestReceipt(db,actor,draft.id,initial.requestId),receipt);
    await api.archiveBriefing(db,actor,draft.id,{requestId:randomUUID(),revision:2,nextVersion:1,reason:'Close fixture',confirmed:true});
    assert.deepEqual(await api.getPreparationRequestReceipt(db,actor,draft.id,initial.requestId),receipt);
    await assert.rejects(async()=>api.getPreparationRequestContext(db,actor,draft.id),/archived/);
  }finally{await f.close();}
});
test('SQLite preparation recovery HTTP requires original session context before receipt or queue effects',async()=>{
  const f=await fixture('sqlite'),draft=await sqlite.createDraft(f.db,owner,{requestId:randomUUID(),title:'HTTP receipt',source});
  const server=sqliteApp(f.db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,path=`${origin}/api/briefings/${draft.id}/preparation-requests`;
  try {
    const login=await contextualFetch(`${origin}/api/auth/staff/login`,{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:JSON.stringify(principalLoginBody('maya'))});
    const cookie=login.headers.get('set-cookie').split(';')[0],body={requestId:randomUUID(),revision:1,jobId:null,generation:0};
    for(const url of [path,`${path}/${body.requestId}`])assert.equal((await fetch(url,{headers:{cookie}})).status,409);
    assert.equal((await fetch(path,{method:'POST',headers:{cookie,'content-type':'application/json',origin:'http://127.0.0.1:3020'},body:JSON.stringify(body)})).status,409);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM preparation_requests').get().n,0);
    assert.equal((await contextualFetch(path,{headers:{cookie}})).status,200);
    const response=await contextualFetch(path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,202);
    const receipt=await contextualFetch(`${path}/${body.requestId}`,{headers:{cookie}});assert.equal(receipt.status,200);assert.match(receipt.headers.get('cache-control'),/no-store/);assert.equal((await receipt.json()).found,true);
  }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
});
