import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createAppServer} from '../server/index.mjs';
import {submitAnswer} from '../server/domain.mjs';
import {workerSubmission} from '../server/responses.mjs';
import {receiveRecording} from '../server/recordings.mjs';
import {checkedWorkerReceiptSnapshot,readWorkerReceiptSnapshot,workerReceiptText,workerReceiptUnknownText} from '../src/worker-submission-receipt.ts';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {issueWorkerGrant,redeemWorkerGrant} from '../server/postgres/auth.mjs';
import {receiveRecording as receivePgRecording} from '../server/postgres/recordings.mjs';
import {syntheticPrepare,CANONICAL_SOURCE} from '../server/domain.mjs';
import {assertWorkerDictionary,assertWorkerStrings} from './helpers/worker-locales.mjs';

const context='a'.repeat(64),requestId='741c20ac-955a-4eee-aa09-94d915578cf9';
const selection={assignmentId:'assignment-30',version:3,language:'ur',requestId,kind:'typed'};
const session=()=>({authenticated:true,role:'worker',workerId:'worker-30',mode:'synthetic-demo',language:'ur',clientContext:context,expiresAt:'2099-01-01T00:00:00.000Z'});
const snapshot=()=>({assignment:{id:'assignment-30',version:3,language:'ur',state:'published'},receipt:{id:requestId,kind:'typed',receivedAt:'2026-10-16T09:18:00.000Z',isLatest:false,answerText:'Synthetic original answer',outcome:'matched',recordingId:null,audioStatus:null,durationSeconds:null},clientContext:context});
function wav(){const bytes=Buffer.alloc(32044);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);bytes.writeInt16LE(1000,44);return bytes;}

test('exact receipt validates original request, kind, version, language and safe metadata rather than latest attempt',()=>{
  assert.equal(checkedWorkerReceiptSnapshot(snapshot(),selection,context).receipt.isLatest,false);
  for(const mutate of [value=>value.assignment.id='other',value=>value.assignment.version=4,value=>value.assignment.language='en',value=>value.receipt.id=randomUUID(),value=>value.receipt.kind='audio',value=>value.receipt.notes='private',value=>value.receipt.durationSeconds=1,value=>value.receipt.receivedAt='invalid',value=>value.receipt.outcome='approved',value=>value.receipt.rubric=['private'],value=>value.source='private']){
    const value=snapshot();mutate(value);assert.throws(()=>checkedWorkerReceiptSnapshot(value,selection,context));
  }
  const audio=snapshot();Object.assign(audio.receipt,{kind:'audio',outcome:null,answerText:null,recordingId:'recording',audioStatus:'received',durationSeconds:1});
  assert.equal(checkedWorkerReceiptSnapshot(audio,{...selection,kind:'audio'},context).receipt.durationSeconds,1);
  for(const durationSeconds of [0,-1,NaN,Infinity,90.1])assert.throws(()=>checkedWorkerReceiptSnapshot({...audio,receipt:{...audio.receipt,durationSeconds}},{...selection,kind:'audio'},context));
  assert.throws(()=>checkedWorkerReceiptSnapshot({...snapshot(),clientContext:'b'.repeat(64)},selection,context),error=>error.code==='session');
});
test('exact receipt GET captures identity and immutable selection through transport and JSON parse, never POSTs',async()=>{
  const identity=session(),captured={...selection};let calls=0;
  const read=(send,current=()=>true)=>readWorkerReceiptSnapshot(send,identity,captured,new AbortController().signal,current);
  const value=await read(async(path,options)=>{calls++;assert.equal(path,`/api/worker/briefings/assignment-30/submissions/${requestId}`);assert.equal(options.headers['x-client-session-context'],context);assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');assert.equal(options.method,undefined);assert.equal(options.body,undefined);return Response.json(snapshot());});
  assert.equal(value.receipt.answerText,'Synthetic original answer');assert.equal(calls,1);
  await assert.rejects(read(async()=>{identity.clientContext='b'.repeat(64);return Response.json(snapshot());}),error=>error.code==='session');identity.clientContext=context;
  await assert.rejects(read(async()=>{captured.version=4;const value=snapshot();value.assignment.version=4;return Response.json(value);}),error=>error.code==='invalid');captured.version=3;
  let current=true;await assert.rejects(read(async()=>({ok:true,status:200,async json(){current=false;return snapshot();}}),()=>current),error=>error.code==='session');
  for(const status of [401,403,409])await assert.rejects(read(async()=>new Response('',{status})),error=>error.code==='session');
  for(const status of [404,429,503])await assert.rejects(read(async()=>new Response('',{status})),error=>error.code==='unavailable');
  await assert.rejects(read(()=>assert.fail('Must not fetch'),()=>false),error=>error.code==='session');
});
test('all immediate receipt states, safety limits and direct Help are localized without fabricating check success',async()=>{
  assertWorkerDictionary(workerReceiptText,'workerReceiptText');assertWorkerStrings(workerReceiptUnknownText,'workerReceiptUnknownText');
  const main=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  assert.match(main,/requestKind:'typed',publicationVersion:receiptScope.version,contentLanguage:receiptScope.language/);
  assert.match(main,/requestKind:'audio',publicationVersion:receiptScope.version,contentLanguage:receiptScope.language/);
  assert.match(main,/onHelp=\{\(\)=>\{pendingHelpAssignment.current=id;setReceipt\(null\);\}\}/);
});
test('SQLite exact receipt stays original after later answer, returns server metadata and denies foreign/staff/staging/invalid reads',async()=>{
  const db=openDatabase(':memory:'),root=await mkdtemp(join(tmpdir(),'understood-exact-receipt-'));
  const server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo',audioRoot:root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const principal={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
  try{
    const typedId=randomUUID(),laterId=randomUUID(),audioId=randomUUID();
    submitAnswer(db,principal,'assignment-30',typedId,'Finished blue; unfinished yellow.');
    submitAnswer(db,principal,'assignment-30',laterId,'Finished yellow; unfinished blue.');
    const audio=await receiveRecording(db,principal,'assignment-30',audioId,wav(),root);
    const login=async principal=>(await fetch(origin+'/api/demo/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({principal})})).headers.get('set-cookie').split(';')[0];
    const own=await login('worker-30'),other=await login('worker-14'),staff=await login('maya');
    const identity=await(await fetch(origin+'/api/session',{headers:{cookie:own}})).json();
    const send=(path,options={})=>fetch(origin+path,{...options,headers:{...options.headers,cookie:own}});
    const tables=['submission_receipts','attempts','recordings','audit'];const inventory=()=>JSON.stringify(tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()));const before=inventory();
    const scoped={assignmentId:'assignment-30',version:3,language:'ur',requestId:typedId,kind:'typed'};
    const original=await readWorkerReceiptSnapshot(send,identity,scoped,new AbortController().signal,()=>true);
    assert.equal(original.receipt.id,typedId);assert.equal(original.receipt.outcome,'matched');assert.equal(original.receipt.isLatest,false);assert.equal(original.receipt.durationSeconds,null);
    assert.equal(original.receipt.receivedAt,db.prepare('SELECT received_at FROM submission_receipts WHERE submission_id=?').get(typedId).received_at);
    const recorded=await readWorkerReceiptSnapshot(send,identity,{...scoped,kind:'audio',requestId:audioId},new AbortController().signal,()=>true);assert.equal(recorded.receipt.recordingId,audio.id);assert.equal(recorded.receipt.durationSeconds,1);assert.equal(recorded.receipt.isLatest,true);
    const path=`/api/worker/briefings/assignment-30/submissions/${typedId}`;
    for(const [cookie,status] of [[undefined,401],[other,404],[staff,403]]){const response=await fetch(origin+path,{headers:cookie?{cookie}:{}});assert.equal(response.status,status);}
    for(const suffix of ['?page=1','?worker_id=other'])assert.equal((await send(path+suffix)).status,400);
    assert.equal((await send(path,{headers:{'x-client-session-context':'f'.repeat(64)}})).status,409);
    assert.equal((await send('/api/worker/briefings/assignment-30/submissions/'+randomUUID())).status,404);
    assert.equal((await send('/api/worker/briefings/assignment-30/submissions/invalid')).status,400);
    assert.ok(!/"(?:rubric|facts|notes|evidence|reasons|sequence|sha256|token|storage)"/.test(JSON.stringify(recorded)));
    const partial=await send(`/api/recordings/${audio.id}/audio`,{headers:{range:'bytes=44-47'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 44-47/32044');assert.deepEqual(Buffer.from(await partial.arrayBuffer()),wav().subarray(44,48));
    assert.equal(partial.headers.get('cache-control'),'no-store');assert.equal(inventory(),before);
    db.prepare("UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'").run();assert.equal(workerSubmission(db,principal,'assignment-30',typedId).receipt.id,typedId);
    db.prepare("UPDATE workers SET active=0 WHERE id='worker-30'").run();assert.equal((await send(path)).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();await rm(root,{recursive:true,force:true});}
});

test('embedded PostgreSQL exact receipt remains bound to its original request and private recording ranges reauthorize before slicing',async()=>{
  const db=new PGlite(),schema='understood_test_exact_receipt',objects=new Map();let tail=Promise.resolve(),server;
  const pool={async connect(){const previous=tail;let release;tail=new Promise(done=>{release=done;});await previous;return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]},release};}};
  const storage={async save(row,bytes){assert.ok(!objects.has(row.id));objects.set(row.id,Buffer.from(bytes));},async read(row){if(!objects.has(row.id))throw Error('Unavailable');return Buffer.from(objects.get(row.id));},async remove(row){objects.delete(row.id);},async exists(row){return objects.has(row.id);}};
  const options={schema},owner={principal_type:'staff',principal_id:'owner',org_id:'qa',site_id:'qa',role:'owner'},worker={...owner,principal_type:'worker',principal_id:'worker'};
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
    await db.exec("INSERT INTO organizations VALUES('qa','Synthetic receipt QA');INSERT INTO sites VALUES('qa','qa','Beirut QA','Asia/Beirut');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','qa','qa','Synthetic Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('worker','qa','qa','Worker 001','en'),('other','qa','qa','Worker 002','en');INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES('brief','qa','qa','Synthetic shelf','Synthetic source','ready');");
    await db.query("INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state) VALUES('publication','qa','qa','brief',3,$1,'published')",[JSON.stringify(syntheticPrepare(CANONICAL_SOURCE))]);
    await db.exec("INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,language) VALUES('assignment','qa','qa','publication','worker','en');");
    const first=randomUUID(),later=randomUUID(),audioId=randomUUID();
    for(const [id,outcome,text] of [[first,'matched','Synthetic original'],[later,'clarification','Synthetic newer']]){
      await db.query("INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json) VALUES($1,'qa','qa','assignment',$1,$2,$3,'[]')",[id,text,outcome]);
      await db.query("INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES('qa','assignment',$1,'typed',clock_timestamp())",[id]);
    }
    const audio=await receivePgRecording(pool,worker,'assignment',audioId,wav(),storage,options);
    const own=await redeemWorkerGrant(pool,(await issueWorkerGrant(pool,owner,'worker',30,options)).token,options),other=await redeemWorkerGrant(pool,(await issueWorkerGrant(pool,owner,'other',30,options)).token,options);
    server=createPostgresRehearsalServer(pool,{...options,storage,tier:'local',aiMode:'synthetic',accessMode:'credential',dataClass:'synthetic',publicOrigin:'http://127.0.0.1:3020'});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,cookie=`understood_pg_rehearsal=${own.token}`;
    const identity=await(await fetch(origin+'/api/session',{headers:{cookie}})).json(),send=(path,options={})=>fetch(origin+path,{...options,headers:{...options.headers,cookie}});
    const tables=['submission_receipts','attempts','recordings','audit'];const inventory=async()=>JSON.stringify(await Promise.all(tables.map(table=>db.query('SELECT * FROM '+table+' ORDER BY 1'))));const before=await inventory();
    const scope={assignmentId:'assignment',version:3,language:'en',requestId:first,kind:'typed'};
    const original=await readWorkerReceiptSnapshot(send,identity,scope,new AbortController().signal,()=>true);assert.equal(original.receipt.outcome,'matched');assert.equal(original.receipt.isLatest,false);assert.equal(original.receipt.answerText,'Synthetic original');
    const newer=await readWorkerReceiptSnapshot(send,identity,{...scope,requestId:later},new AbortController().signal,()=>true);assert.equal(newer.receipt.outcome,'clarification');
    const recorded=await readWorkerReceiptSnapshot(send,identity,{...scope,kind:'audio',requestId:audioId},new AbortController().signal,()=>true);assert.equal(recorded.receipt.durationSeconds,1);assert.equal(recorded.receipt.recordingId,audio.id);
    const path=`/api/worker/briefings/assignment/submissions/${first}`;
    assert.equal((await fetch(origin+path)).status,401);assert.equal((await fetch(origin+path,{headers:{cookie:`understood_pg_rehearsal=${other.token}`}})).status,404);
    assert.equal((await send(path+'?page=1')).status,400);assert.equal((await send(path,{headers:{'x-client-session-context':'f'.repeat(64)}})).status,409);
    const partial=await send(`/api/recordings/${audio.id}/audio`,{headers:{range:'bytes=44-47'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 44-47/32044');assert.deepEqual(Buffer.from(await partial.arrayBuffer()),wav().subarray(44,48));
    assert.equal((await fetch(origin+`/api/recordings/${audio.id}/audio`,{headers:{cookie:`understood_pg_rehearsal=${other.token}`,range:'bytes=0-43'}})).status,404);
    assert.equal(await inventory(),before);
    objects.get(audio.id).writeInt16LE(2000,44);const corrupt=await send(`/api/recordings/${audio.id}/audio`,{headers:{range:'bytes=0-43'}});assert.equal(corrupt.ok,false);assert.equal(corrupt.headers.get('content-range'),null);
    await db.exec("UPDATE publications SET state='withdrawn' WHERE id='publication'");assert.equal((await readWorkerReceiptSnapshot(send,identity,scope,new AbortController().signal,()=>true)).receipt.id,first);
    await db.exec("UPDATE workers SET active=false WHERE id='worker'");assert.equal((await send(path)).status,401);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
});
