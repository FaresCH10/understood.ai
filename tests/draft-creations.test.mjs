import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createDraft as localCreate,editDraft as localEdit,archiveBriefing as localArchive,queuePreparation as localQueue,ensureBriefingSchema} from '../server/preparation.mjs';
import {createDraft as pgCreate,editDraft as pgEdit,archiveBriefing as pgArchive,queuePreparation as pgQueue,processOnePreparation} from '../server/postgres/preparation.mjs';
import {draftCreationReceipt as localReceipt} from '../server/draft-creations.mjs';
import {draftCreationReceipt as pgReceipt} from '../server/postgres/draft-creations.mjs';
import {createAppServer} from '../server/index.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {createSession} from '../server/auth.mjs';
import {provisionStaffCredential} from '../server/postgres/auth.mjs';
import {draftInput} from '../server/briefing-input.mjs';
import {readPendingDraftCreation,savePendingDraftCreation,clearPendingDraftCreation,checkedDraftCreationResult,checkedDraftCreationReceipt} from '../src/draft-creation-recovery.ts';
import {processOne} from '../server/worker.mjs';
import {ensureSettingsSchema,updateSettings as localSettings} from '../server/settings.mjs';
import {updateSettings as pgSettings} from '../server/postgres/settings.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {openPrincipalSession} from './helpers/sqlite-app.mjs';


const owner={principal_type:'staff',principal_id:'owner',role:'owner',org_id:'a',site_id:'a'},origin='http://127.0.0.1:3020';
const body=()=>({requestId:randomUUID(),title:' Shelf draft ',source:' Put finished items on the blue shelf. '});
async function fixture(postgres) {
  const db=postgres?new PGlite():openDatabase(':memory:'),schema='understood_test_draft_creations';let fail=false,auditFail=false;
  const blocked=sql=>{if(fail && sql.includes('FROM draft_creations'))throw Error('Private creation SQL sentinel');if(auditFail && sql.includes('INSERT INTO audit'))throw Error('Audit unavailable');};
  const client={async query(sql,args){blocked(sql);return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}},options={schema};
  if(postgres){await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});}else {seed(db);const prepare=db.prepare.bind(db);db.prepare=sql=>{blocked(sql);return prepare(sql);};}
  const exec=async(sql,args=[])=>{if(!postgres)return {rows:db.prepare(sql).all(...args)};let n=0;return db.query(sql.replaceAll('?',()=>`$${++n}`),args);};
  await exec("INSERT INTO organizations VALUES('a','A'),('b','B')");
  await exec("INSERT INTO sites VALUES('a','a','A','UTC'),('other','a','Other','UTC'),('b','b','B','UTC')");
  await exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner'),('reader','a','a','Reader','auditor')");
  return {db,pool,options,exec,setFail:v=>{fail=v;},setAuditFail:v=>{auditFail=v;},close:()=>db.close(),
    create:input=>postgres?pgCreate(pool,owner,input,options):localCreate(db,owner,input),
    edit:(id,input)=>postgres?pgEdit(pool,owner,id,input,options):localEdit(db,owner,id,input),
    archive:(id,input)=>postgres?pgArchive(pool,owner,id,input,options):localArchive(db,owner,id,input),
    receipt:(s,id)=>postgres?pgReceipt(pool,s,id,options):localReceipt(db,s,id)};
}
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} creation language choice is immutable, canonical and independent of later site defaults`,async()=>{
  const f=await fixture(postgres);
  try {
    if(!postgres)ensureSettingsSchema(f.db);
    const input={...body(),source:CANONICAL_SOURCE,generationLanguages:['ur','en']};
    const first=await f.create(input);assert.equal((await f.create({...input,generationLanguages:['en','ur']})).duplicate,true);
    await assert.rejects(async()=>f.create({...input,generationLanguages:['en','ar']}),/conflict/);
    const row=(await f.exec('SELECT generation_languages_json FROM draft_creations WHERE briefing_id=?',[first.id])).rows[0];assert.deepEqual(postgres?row.generation_languages_json:JSON.parse(row.generation_languages_json),['en','ur']);
    const site={requestId:randomUUID(),revision:0,name:'Site A',timezone:'UTC',generationLanguages:['en','ar'],confirmed:true};
    if(postgres)await pgSettings(f.pool,owner,'site',site,f.options);else localSettings(f.db,owner,'site',site);
    if(postgres){await pgQueue(f.pool,owner,first.id,1,f.options);await processOnePreparation(f.pool,{...f.options,integrationMode:'synthetic'});}else{localQueue(f.db,owner,first.id,1);while(processOne(f.db)) {}}
    const prepared=(await f.exec('SELECT state,prepared_json FROM briefings WHERE id=?',[first.id])).rows[0];assert.equal(prepared.state,'ready');assert.deepEqual(Object.keys((postgres?prepared.prepared_json:JSON.parse(prepared.prepared_json)).languages).sort(),['en','ur']);
    await f.edit(first.id,{revision:1,title:'Later source title',source:CANONICAL_SOURCE});assert.equal((await f.create(input)).duplicate,true);
    assert.equal(await checkedDraftCreationReceipt(await f.receipt(owner,first.id),input),first.id);
    for(const generationLanguages of [[],['ar'],['en','en'],['en','xx'],null])await assert.rejects(async()=>f.create({...body(),generationLanguages}),/Invalid/);
    const legacy=body(),now=new Date().toISOString();await f.exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[legacy.requestId,'a','a',legacy.title.trim(),legacy.source.trim(),'draft',now,now]);
    await assert.rejects(async()=>f.create({...legacy,generationLanguages:['en']}),/conflict/);assert.equal((await f.receipt(owner,legacy.requestId)).accepted,false);
  }finally {await f.close();}
});
test('SQLite creation-choice upgrade retains earlier receipt hashes and does not invent a selection',async()=>{
  const f=await fixture(false);
  try {
    const input=body(),original=await f.create(input);f.db.exec('DROP TRIGGER IF EXISTS draft_creations_generation_locales_insert;DROP TRIGGER IF EXISTS draft_creations_generation_locales_update;ALTER TABLE draft_creations DROP COLUMN generation_languages_json');
    ensureBriefingSchema(f.db);ensureBriefingSchema(f.db);
    const row=f.db.prepare('SELECT request_hash,generation_languages_json FROM draft_creations WHERE request_id=?').get(input.requestId);assert.equal(row.request_hash,original.requestHash);assert.equal(row.generation_languages_json,null);
    assert.deepEqual(await f.create(input),{...original,duplicate:true});await assert.rejects(async()=>f.create({...input,generationLanguages:['en']}),/conflict/);
  }finally {await f.close();}
});
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} draft creation evidence survives edits/archive, rejects changed intent and rolls back with audit`,async()=>{
  const f=await fixture(postgres);
  try {
    const input=body(),first=await f.create(input),hash=createHash('sha256').update(JSON.stringify(draftInput(input,'create'))).digest('hex');
    assert.deepEqual(first,{id:input.requestId,state:'draft',revision:1,requestHash:hash,duplicate:false});
    await f.edit(input.requestId,{revision:1,title:'Edited title',source:'Now a different source instruction.'});
    assert.deepEqual(await f.create(input),{...first,duplicate:true});
    await assert.rejects(async()=>f.create({...input,title:'Edited title',source:'Now a different source instruction.'}),/conflict/);
    await f.archive(input.requestId,{requestId:randomUUID(),revision:2,nextVersion:1,reason:'Fixture only',confirmed:true});
    assert.deepEqual(await f.create(input),{...first,duplicate:true});
    const before=JSON.stringify((await f.exec('SELECT id,action,object_id FROM audit ORDER BY id')).rows);
    const receipt=await f.receipt(owner,input.requestId);assert.deepEqual(receipt,{requestId:input.requestId,accepted:true,result:{id:input.requestId,state:'draft',revision:1,requestHash:hash}});
    assert.equal(await checkedDraftCreationReceipt(receipt,input),input.requestId);
    const evidence=(await f.exec('SELECT * FROM draft_creations WHERE request_id=?',[input.requestId])).rows[0];assert.equal(evidence.request_hash,hash);assert.ok(!JSON.stringify(evidence).includes('Shelf'));
    for(const sql of ['UPDATE draft_creations SET request_hash=? WHERE request_id=?','DELETE FROM draft_creations WHERE request_id=?'])await assert.rejects(async()=>f.exec(sql,sql.startsWith('UPDATE')?['f'.repeat(64),input.requestId]:[input.requestId]),/immutable/);
    const missing=randomUUID();assert.deepEqual(await f.receipt(owner,missing),{requestId:missing,accepted:false});
    for(const actor of [{...owner,principal_type:'worker'},{...owner,role:'auditor',principal_id:'reader'},{...owner,token_hash:'f'.repeat(64)}])await assert.rejects(async()=>f.receipt(actor,input.requestId),/Forbidden|Sign in required/);
    assert.equal(JSON.stringify((await f.exec('SELECT id,action,object_id FROM audit ORDER BY id')).rows),before);
    await f.exec("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('other-owner','a','other','Other owner','owner')");
    assert.deepEqual(await f.receipt({...owner,principal_id:'other-owner',site_id:'other'},input.requestId),{requestId:input.requestId,accepted:false});
    await assert.rejects(async()=>f.receipt(owner,'bad'),/Invalid draft creation/);
    const failed=body();f.setAuditFail(true);await assert.rejects(async()=>f.create(failed),/Audit unavailable/);f.setAuditFail(false);
    assert.equal((await f.exec('SELECT id FROM briefings WHERE id=?',[failed.requestId])).rows.length,0);assert.equal((await f.receipt(owner,failed.requestId)).accepted,false);
    const legacy=body(),now=new Date().toISOString();await f.exec('INSERT INTO briefings(id,org_id,site_id,title,source,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[legacy.requestId,'a','a',legacy.title.trim(),legacy.source.trim(),'draft',now,now]);
    assert.equal((await f.create(legacy)).duplicate,true);assert.equal((await f.receipt(owner,legacy.requestId)).accepted,false);
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='owner'`);await assert.rejects(async()=>f.receipt(owner,input.requestId),/Forbidden/);
  }finally {await f.close();}
});
for(const postgres of [false,true])test(`${postgres?'PostgreSQL':'SQLite'} draft receipt HTTP is read-only, scoped, no-store and sanitized`,async()=>{
  const f=await fixture(postgres),config={tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin,schema:f.options.schema,dataClass:'synthetic'},password='Disposable receipt password only';
  if(postgres)for(const staffId of ['owner','reader'])await provisionStaffCredential(f.pool,{staffId,orgId:'a',siteId:'a',email:`${staffId}@example.test`,password},{schema:f.options.schema});
  const server=postgres?createPostgresRehearsalServer(f.pool,config):createAppServer(f.db,config);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async staffId=>{
    if(!postgres)return `understood_session=${openPrincipalSession(f.db,f.db.prepare('SELECT * FROM staff WHERE id=?').get(staffId)).token}`;
    const r=await fetch(`${base}/auth/staff/login`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:`${staffId}@example.test`,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
  };
  try {
    const cookie=await login('owner'),reader=await login('reader'),input=body();await f.create(input);
    const path=`${base}/draft-creation-receipts/${input.requestId}`,before=JSON.stringify((await f.exec('SELECT id,action FROM audit ORDER BY id')).rows);
    const read=await fetch(path,{headers:{cookie}});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(await checkedDraftCreationReceipt(await read.json(),input),input.requestId);
    assert.equal((await fetch(path+'?org_id=b',{headers:{cookie}})).status,400);assert.equal((await fetch(path.replace(input.requestId,'bad'),{headers:{cookie}})).status,400);
    assert.equal((await fetch(path,{headers:{cookie:reader}})).status,403);assert.equal((await fetch(path)).status,401);
    f.setFail(true);const failed=await fetch(path,{headers:{cookie}});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('sentinel'));f.setFail(false);
    assert.equal(JSON.stringify((await f.exec('SELECT id,action FROM audit ORDER BY id')).rows),before);
    await f.exec(`UPDATE staff SET active=${postgres?'false':'0'} WHERE id='owner'`);assert.equal((await fetch(path,{headers:{cookie}})).status,401);
  }finally {await new Promise(r=>server.close(r));await f.close();}
});
test('draft tab recovery bounds storage, identity and exact hashes without leaking source in receipt',async()=>{
  const rows=new Map(),storage={getItem:k=>rows.get(k) ?? null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},pending=body();
  savePendingDraftCreation(storage,'one',pending);assert.deepEqual(readPendingDraftCreation(storage,'one'),pending);assert.equal(readPendingDraftCreation(storage,'other'),null);
  for(const patch of [{requestId:randomUUID()},{title:'Changed'},{source:'Some different source instruction.'}])assert.throws(()=>savePendingDraftCreation(storage,'one',{...pending,...patch}));
  assert.throws(()=>savePendingDraftCreation({getItem:()=>null,setItem(){},removeItem(){}},'one',pending),/No request was sent/);
  assert.throws(()=>readPendingDraftCreation({getItem(){throw Error();}},'one'),/unavailable/);
  const result={id:pending.requestId,state:'draft',revision:1,requestHash:createHash('sha256').update(JSON.stringify(draftInput(pending,'create'))).digest('hex')},receipt={accepted:true,requestId:pending.requestId,result};
  assert.equal(await checkedDraftCreationResult(result,pending),pending.requestId);assert.equal(await checkedDraftCreationReceipt(receipt,pending),pending.requestId);
  assert.equal(await checkedDraftCreationReceipt({accepted:false,requestId:pending.requestId},pending),null);
  for(const patch of [{id:randomUUID()},{state:'ready'},{revision:2},{requestHash:'f'.repeat(64)}])await assert.rejects(()=>checkedDraftCreationResult({...result,...patch},pending),/match/);
  for(const patch of [{accepted:false},{accepted:'true'},{requestId:randomUUID()}])await assert.rejects(()=>checkedDraftCreationReceipt({...receipt,...patch},pending),/match/);
  assert.throws(()=>clearPendingDraftCreation(storage,'one',{...pending,requestId:randomUUID()}),/changed/);clearPendingDraftCreation(storage,'one',pending);assert.equal(readPendingDraftCreation(storage,'one'),null);
  for(const raw of ['{}','[]','null','x'.repeat(30001),JSON.stringify({...pending,secret:'invalid'})]){rows.set('understood:draft-creation:one',raw);assert.throws(()=>readPendingDraftCreation(storage,'one'),/cannot be verified/);}
});
test('custom draft language selection survives tab recovery and participates in exact acknowledgement checks',async()=>{
  const rows=new Map(),storage={getItem:k=>rows.get(k) ?? null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},pending={...body(),generationLanguages:['en','ar']};
  savePendingDraftCreation(storage,'custom',pending);assert.deepEqual(readPendingDraftCreation(storage,'custom'),pending);
  assert.throws(()=>savePendingDraftCreation(storage,'custom',{...pending,generationLanguages:['en','ur']}),/Resolve/);
  const result={id:pending.requestId,state:'draft',revision:1,requestHash:createHash('sha256').update(JSON.stringify(draftInput(pending,'create'))).digest('hex')};
  assert.equal(await checkedDraftCreationResult(result,pending),pending.requestId);await assert.rejects(()=>checkedDraftCreationResult(result,{...pending,generationLanguages:['en']}),/match/);
  clearPendingDraftCreation(storage,'custom',pending);assert.equal(readPendingDraftCreation(storage,'custom'),null);
});
