import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {CANONICAL_SOURCE,syntheticPrepare,publish as localPublish} from '../server/domain.mjs';
import {processOne} from '../server/worker.mjs';
import {createDraft,archiveBriefing} from '../server/preparation.mjs';
import {createDraft as pgCreateDraft,archiveBriefing as pgArchive} from '../server/postgres/preparation.mjs';
import {glossaryInput,glossaryFilters,glossaryHistory,checkedSyntheticGlossary,assertGlossaryCurrent} from '../server/glossary-input.mjs';
import {glossarySnapshot} from '../server/glossary-snapshot.mjs';
import {changeGlossary,listGlossary,getGlossaryTerm,glossaryReceipt,readGlossarySnapshot} from '../server/glossary.mjs';
import {changeGlossary as pgChange,listGlossary as pgList,getGlossaryTerm as pgGet,glossaryReceipt as pgReceipt,readGlossarySnapshot as pgSnapshot} from '../server/postgres/glossary.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {publish as pgPublish} from '../server/postgres/domain.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';
import {principalLoginBody,seedCredentials} from './helpers/sqlite-app.mjs';

const fetch=createSessionContextFetch();
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const input=patch=>({requestId:randomUUID(),confirmed:true,...patch});
const content={term:'blue shelf',sourceLanguage:'en',targetLanguage:'ar',override:''};
test('glossary input, literal filters, history and dependency hashes are strict and repository-independent',()=>{
  for(const patch of [{confirmed:false},{term:''},{term:'a\nterm'},{term:'a'.repeat(201)},{requestId:'bad'},{sourceLanguage:'fr'},{targetLanguage:'en'},{override:null},{override:'a'.repeat(501)},{suggestion:'fake'},{org_id:'foreign'}]) assert.throws(()=>glossaryInput('create',null,input({...content,...patch})),/Invalid/);
  assert.equal(glossaryInput('create',null,input({...content,term:'  BLUE SHELF  '})).term,'BLUE SHELF');
  for(const filter of [{status:'ready'},{page:0},{pageSize:101},{targetLanguage:'fr'},{search:'a'.repeat(81)},{site_id:'foreign'}]) assert.throws(()=>glossaryFilters(filter),/Invalid/);
  for(const filter of [{page:0},{version:0},{version:1.2},{unknown:true}]) assert.throws(()=>glossaryHistory(filter),/Invalid/);
  const row={id:'one',revision:1,status:'active',term:'blue shelf',source_lang:'en',target_lang:'ar',content_json:{override:'',suggestion:'الرف الأزرق',provenance:{adapter:'synthetic-glossary-v1',live:false}}};
  const sqlite=glossarySnapshot([{...row,content_json:JSON.stringify(row.content_json)}]),pg=glossarySnapshot([{...row,content_json:{provenance:{live:false,adapter:'synthetic-glossary-v1'},suggestion:'الرف الأزرق',override:''}}]);
  assert.deepEqual(sqlite,pg);const prepared=checkedSyntheticGlossary(syntheticPrepare(CANONICAL_SOURCE),sqlite);assertGlossaryCurrent(prepared,pg);
  assert.throws(()=>assertGlossaryCurrent(prepared,glossarySnapshot([{...row,revision:2}])),/dependency changed/);
  assert.throws(()=>checkedSyntheticGlossary(prepared,glossarySnapshot([{...row,content_json:{...row.content_json,override:'Wrong colour'}}])),/cannot apply/);
});
async function fixture(pg) {
  if(!pg) {
    const db=openDatabase(':memory:');seed(db);db.prepare('INSERT INTO staff VALUES(?,?,?,?,?,1)').run('auditor','cedar','beirut','Auditor','auditor');
    db.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(JSON.stringify(syntheticPrepare(CANONICAL_SOURCE)));
    return {db,change:(s,k,id,v)=>changeGlossary(db,s,k,id,v),list:(s,v)=>listGlossary(db,s,v),get:(s,id,v)=>getGlossaryTerm(db,s,id,v),receipt:(s,id)=>glossaryReceipt(db,s,id),snapshot:()=>readGlossarySnapshot(db,'cedar','beirut'),process:()=>processOne(db),publish:v=>localPublish(db,owner,'shelf',v),raw:async(sql,v=[])=>({rows:db.prepare(sql).all(...v)}),fail(){db.exec("CREATE TRIGGER reject_glossary_audit BEFORE INSERT ON audit WHEN NEW.action LIKE 'glossary.%' BEGIN SELECT RAISE(ABORT,'Injected glossary audit failure'); END");},reset(){db.exec('DROP TRIGGER reject_glossary_audit');},close:async()=>db.close()};
  }
  const db=new PGlite(),options={schema:'understood_test_glossary'};let fail=false,lost=false;
  const pool={async connect(){return {async query(sql,v){if(fail && sql.includes('INSERT INTO audit')) throw new Error('Injected glossary audit failure');const result=v?.length ? await db.query(sql,v) : (await db.exec(sql)).at(-1) || {rows:[]};if(lost && sql==='COMMIT') {lost=false;throw new Error('Lost glossary commit receipt');}return result;},release(){}};}};
  await db.exec(`CREATE SCHEMA ${options.schema};SET search_path TO ${options.schema},pg_catalog`);await runMigrations(pool,options);
  await db.query("INSERT INTO organizations VALUES('cedar','Cedar Works'),('foreign','Foreign')");await db.query("INSERT INTO sites VALUES('beirut','cedar','Beirut','Asia/Beirut'),('foreign','foreign','Foreign','UTC')");
  await db.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('maya','cedar','beirut','Maya','owner'),('auditor','cedar','beirut','Auditor','auditor'),('foreign','foreign','foreign','Foreign','owner')");
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker-14','cedar','beirut','Worker 014','ar')");
  await db.query("INSERT INTO briefings(id,org_id,site_id,title,source,state,prepared_json) VALUES('shelf','cedar','beirut','Shelf',$1,'ready',$2)",[CANONICAL_SOURCE,JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
  await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('shelf-v3','cedar','beirut','shelf',3,$1,'published')",[JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
  await db.query("UPDATE briefings SET next_version=4 WHERE id='shelf'");
  return {db,pool,options,change:(s,k,id,v)=>pgChange(pool,s,k,id,v,options),list:(s,v)=>pgList(pool,s,v,options),get:(s,id,v)=>pgGet(pool,s,id,v,options),receipt:(s,id)=>pgReceipt(pool,s,id,options),snapshot:()=>pool.connect().then(async c=>{try {return await pgSnapshot(c,'cedar','beirut');}finally {c.release();}}),process:()=>processOnePreparation(pool,{...options,integrationMode:'synthetic'}),publish:v=>pgPublish(pool,owner,'shelf',v,{...options,integrationMode:'synthetic'}),raw:(sql,v)=>db.query(sql,v),fail(){fail=true;},reset(){fail=false;},lose(){lost=true;},close:()=>db.close()};
}
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} glossary versions, scoped receipts, draft invalidation and private HTTP preserve publication history`,async()=>{
  const f=await fixture(pg),auditor={...owner,principal_id:'auditor',role:'auditor'},create=input(content),id=create.requestId;
  try {
    const before=JSON.stringify((await f.raw('SELECT * FROM publications ORDER BY id')).rows),draftBefore=JSON.stringify((await f.raw("SELECT revision,state,prepared_json FROM briefings WHERE id='shelf'")).rows);
    for(const s of [auditor,{...owner,principal_type:'worker'},{...owner,principal_id:'missing'},{...owner,site_id:'foreign'}]) await assert.rejects(async()=>f.change(s,'create',null,create),/Forbidden/);
    f.fail();await assert.rejects(async()=>f.change(owner,'create',null,create),/Injected/);f.reset();assert.equal((await f.list(owner)).total,0);assert.equal(JSON.stringify((await f.raw("SELECT revision,state,prepared_json FROM briefings WHERE id='shelf'")).rows),draftBefore);
    if(pg) {f.lose();await assert.rejects(f.change(owner,'create',null,create),/Lost glossary/);} else await f.change(owner,'create',null,create);
    assert.equal((await f.change(owner,'create',null,create)).duplicate,true);assert.equal((await f.receipt(owner,id)).result.revision,1);
    const colleague={...owner,principal_id:'colleague',role:'supervisor'};
    await f.raw("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('colleague','cedar','beirut','Synthetic colleague','supervisor')");
    assert.deepEqual(await f.receipt(colleague,id),{found:false});
    await assert.rejects(async()=>f.change(colleague,'create',null,create),/conflict/);
    await assert.rejects(async()=>f.change(owner,'create',null,{...create,override:'conflict'}),/conflict/);
    await assert.rejects(async()=>f.change(owner,'create',null,input({...content,term:' BLUE SHELF '})),/already exists/);
    let draft=(await f.raw("SELECT revision,state,prepared_json FROM briefings WHERE id='shelf'")).rows[0];assert.equal(draft.revision,2);assert.equal(draft.state,'processing');assert.equal(draft.prepared_json,null);
    await f.process();draft=(await f.raw("SELECT revision,state,prepared_json FROM briefings WHERE id='shelf'")).rows[0];assert.equal(draft.state,'ready');let prepared=typeof draft.prepared_json==='string' ? JSON.parse(draft.prepared_json) : draft.prepared_json;assertGlossaryCurrent(prepared,await f.snapshot());
    const revisionBeforeInvalid=JSON.stringify((await f.raw('SELECT * FROM glossary_terms')).rows);await assert.rejects(async()=>f.change(owner,'edit',id,input({revision:0,override:''})),/Invalid/);assert.equal(JSON.stringify((await f.raw('SELECT * FROM glossary_terms')).rows),revisionBeforeInvalid);
    const edit=input({revision:1,override:'Other colour'});await f.change(owner,'edit',id,edit);await f.process();assert.equal((await f.raw("SELECT state FROM briefings WHERE id='shelf'")).rows[0].state,'failed');
    assert.equal((await f.get(owner,id,{version:1})).selected.content.override,'');assert.equal((await f.get(owner,id)).selected.content.override,'Other colour');
    assert.equal((await f.receipt(owner,id)).result.revision,1);assert.equal((await f.change(owner,'edit',id,edit)).duplicate,true);await assert.rejects(async()=>f.change(owner,'edit',id,input({revision:1,override:''})),/revision changed/);
    await f.change(owner,'edit',id,input({revision:2,override:''}));await f.process();assert.equal((await f.raw("SELECT state FROM briefings WHERE id='shelf'")).rows[0].state,'ready');
    // A ready artifact copied across revisions cannot bypass the glossary dependency check.
    await f.raw(pg ? 'UPDATE briefings SET prepared_json=$1 WHERE id=\'shelf\'' : 'UPDATE briefings SET prepared_json=? WHERE id=\'shelf\'',[JSON.stringify(prepared)]);
    await assert.rejects(async()=>f.publish({requestId:randomUUID(),revision:4,nextVersion:4,workerIds:['worker-14'],dueAt:null}),/dependency changed/);
    await f.change(owner,'remove',id,input({revision:3}));assert.equal((await f.list(owner)).total,0);assert.equal((await f.list(owner,{status:'removed'})).total,1);await assert.rejects(async()=>f.change(owner,'edit',id,input({revision:4,override:''})),/removed/);
    await f.change(owner,'restore',id,input({revision:4}));assert.equal((await f.get(owner,id)).revision,5);
    for(let revision=5;revision<26;revision++) await f.change(owner,'regenerate',id,input({revision}));const history=(await f.get(owner,id,{page:2})).history;assert.equal(history.total,26);assert.equal(history.items.length,6);
    for(let n=0;n<22;n++) await f.change(owner,'create',null,input({...content,term:`Paged term ${String(n).padStart(2,'0')}`,override:'Custom wording'}));
    const page=await f.list(owner,{search:'Paged term',page:2,pageSize:20});assert.equal(page.total,22);assert.equal(page.items.length,2);assert.equal((await f.list(owner,{search:'%'})).total,0);assert.equal((await f.list(owner,{search:'synthetic-glossary-v1'})).total,0);assert.equal((await f.list(owner,{search:'الرف الأزرق'})).total,1);
    const unsupported=page.items[0];await assert.rejects(async()=>f.change(owner,'regenerate',unsupported.id,input({revision:1})),/Live glossary generation unavailable/);
    for(const table of ['glossary_versions','glossary_requests']) {await assert.rejects(f.raw(`UPDATE ${table} SET created_by='auditor'`),/immutable/);await assert.rejects(f.raw(`DELETE FROM ${table}`),/immutable/);}
    const foreign={...owner,principal_id:pg ? 'foreign' : 'harbor-owner',org_id:pg ? 'foreign' : 'harbor',site_id:pg ? 'foreign' : 'harbor-yard'};
    assert.equal((await f.list(foreign)).total,0);assert.deepEqual(await f.receipt(foreign,id),{found:false});await assert.rejects(async()=>f.get(foreign,id),/unavailable/);assert.equal((await f.list(auditor)).total,23);await assert.rejects(async()=>f.receipt(auditor,id),/Forbidden/);
    assert.equal(JSON.stringify((await f.raw('SELECT * FROM publications ORDER BY id')).rows),before);
    const config={tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020',...(pg ? f.options : {})};
    if(pg) await provisionStaffCredential(f.pool,{staffId:'maya',orgId:'cedar',siteId:'beirut',email:'glossary@example.test',password:'Synthetic-glossary-password-123'},f.options);
    else seedCredentials(f.db);
    const server=pg ? createPostgresRehearsalServer(f.pool,config) : createAppServer(f.db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=(path,cookie,body)=>fetch(base+path,{method:body ? 'POST' : 'GET',headers:{origin:config.publicOrigin,'content-type':'application/json',...(cookie ? {cookie} : {})},body:body ? JSON.stringify(body) : undefined});
    try {
      assert.equal((await call('/glossary')).status,401);const login=await call('/auth/staff/login',null,pg ? {email:'glossary@example.test',password:'Synthetic-glossary-password-123'} :principalLoginBody('maya')),cookie=login.headers.get('set-cookie').split(';')[0];
      const list=await call('/glossary?page=2&pageSize=20',cookie);assert.equal(list.status,200);assert.match(list.headers.get('cache-control'),/no-store/);
      assert.equal((await call('/glossary?scope=foreign',cookie)).status,400);assert.equal((await call('/glossary/receipts/bad',cookie)).status,400);assert.equal((await call('/glossary/'+id+'?version=1',cookie)).status,200);
      assert.equal((await call('/glossary/'+id+'/edit',cookie,input({revision:1,override:''}))).status,409);assert.equal((await call('/glossary/missing',cookie)).status,404);
      const next=input({...content,term:'HTTP term'});assert.equal((await call('/glossary',cookie,next)).status,201);assert.equal((await call('/glossary',cookie,next)).status,200);assert.equal((await call('/glossary/receipts/'+next.requestId,cookie)).status,200);
      assert.equal((await call('/glossary',cookie,{...next,org_id:'foreign'})).status,400);
    } finally {await new Promise(resolve=>server.close(resolve));}
    await f.raw(pg ? "UPDATE staff SET active=false WHERE id='maya'" : "UPDATE staff SET active=0 WHERE id='maya'");await assert.rejects(async()=>f.change(owner,'create',null,create),/Forbidden/);await assert.rejects(async()=>f.list(owner),/Forbidden/);
  } finally {await f.close();}
});
for(const pg of [false,true]) test(`${pg ? 'PostgreSQL' : 'SQLite'} glossary edits retain draft review values, skip archives and do not change foreign drafts`,async()=>{
  const f=await fixture(pg);
  try {
    const fresh=input({title:'Unprepared glossary draft',source:CANONICAL_SOURCE});delete fresh.confirmed;
    const draft=pg ? await pgCreateDraft(f.pool,owner,fresh,f.options) : createDraft(f.db,owner,fresh);
    const archivedInput={requestId:randomUUID(),title:'Archived glossary draft',source:CANONICAL_SOURCE},archive={requestId:randomUUID(),revision:1,nextVersion:1,reason:'Retain archived evidence',confirmed:true};
    const archived=pg ? await pgCreateDraft(f.pool,owner,archivedInput,f.options) : createDraft(f.db,owner,archivedInput);
    if(pg) await pgArchive(f.pool,owner,archived.id,archive,f.options);else archiveBriefing(f.db,owner,archived.id,archive);
    const review={revision:1,question:'Retain this question',facts:['Retain this fact'],askedFacts:['Retain this private rubric']};
    await f.raw(pg ? 'INSERT INTO draft_reviews VALUES($1,$2,$3,$4)' : 'INSERT INTO draft_reviews VALUES(?,?,?,?)',[draft.id,'cedar','beirut',JSON.stringify(review)]);
    await f.raw(pg ? "INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('foreign-draft','foreign','foreign','Foreign','Foreign source','draft')" : "INSERT INTO briefings VALUES('foreign-draft','harbor','harbor-yard','Foreign','Foreign source',1,1,'draft',NULL,'2026-10-01','2026-10-01')");
    const change=await f.change(owner,'create',null,input(content));assert.equal(change.invalidatedDrafts,2);
    const retained=(await f.raw(pg ? 'SELECT revision,state,prepared_json FROM briefings WHERE id=$1' : 'SELECT revision,state,prepared_json FROM briefings WHERE id=?',[draft.id])).rows[0];assert.equal(retained.revision,2);assert.equal(retained.state,'draft');assert.equal(retained.prepared_json,null);
    const raw=(await f.raw(pg ? 'SELECT content_json FROM draft_reviews WHERE briefing_id=$1' : 'SELECT content_json FROM draft_reviews WHERE briefing_id=?',[draft.id])).rows[0].content_json;assert.deepEqual(typeof raw==='string' ? JSON.parse(raw) : raw,{...review,revision:2});
    assert.equal((await f.raw(pg ? 'SELECT revision FROM briefings WHERE id=$1' : 'SELECT revision FROM briefings WHERE id=?',[archived.id])).rows[0].revision,1);assert.equal((await f.raw("SELECT revision FROM briefings WHERE id='foreign-draft'")).rows[0].revision,1);
  } finally {await f.close();}
});
test('PostgreSQL preparation completion cannot restore glossary-stale readiness after a newer terminology edit',async()=>{
  const f=await fixture(true),create=input(content);
  try {
    await f.change(owner,'create',null,create);
    await processOnePreparation(f.pool,{...f.options,integrationMode:'synthetic',prepare:async source=>{await f.change(owner,'edit',create.requestId,input({revision:1,override:''}));return syntheticPrepare(source);}});
    const draft=(await f.raw("SELECT revision,state,prepared_json FROM briefings WHERE id='shelf'")).rows[0];assert.equal(draft.revision,3);assert.equal(draft.state,'processing');assert.equal(draft.prepared_json,null);assert.equal((await f.raw('SELECT status FROM jobs WHERE revision=2')).rows[0].status,'failed');
    await f.process();const current=(await f.raw("SELECT state,prepared_json FROM briefings WHERE id='shelf'")).rows[0];assert.equal(current.state,'ready');assertGlossaryCurrent(current.prepared_json,await f.snapshot());assert.equal(current.prepared_json.provenance.glossary.revision,2);
  } finally {await f.close();}
});
