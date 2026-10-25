import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { createAppServer } from '../server/index.mjs';
import { submitAnswer,withdrawPublication,publish } from '../server/domain.mjs';
import { receiveRecording } from '../server/recordings.mjs';
import { responseFilters,responseRequest,listPublicationResponses,getPublicationResponse,workerSubmissions,staffWorkerAssignments,workerBriefings,workerInboxFilters,workerRequestReceipt } from '../server/responses.mjs';
import {requestHelp} from '../server/clarifications.mjs';
import {checkedWorkerReceipt} from '../src/worker-request.ts';

const staff={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const worker={principal_type:'worker',principal_id:'worker-30',org_id:'cedar',site_id:'beirut'};
function wav() {
  const bytes=Buffer.alloc(32044);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);bytes.writeInt16LE(1000,44);return bytes;
}

test('response filters and detail requests reject unknown fields and unsafe bounds',() => {
  assert.deepEqual(responseFilters(),{search:'',language:'all',status:'all',page:1,pageSize:20});
  for(const input of [null,[],{page:0},{page:5001},{pageSize:51},{pageSize:0},{pageSize:1.2},{search:'a'.repeat(81)},
    {status:'resolved'},{language:'xyz'},{org_id:'other'}]) assert.throws(() => responseFilters(input),/Invalid response filter/);
  for(const input of [null,[],{status:'all'}]) assert.throws(() => responseRequest('p','a',input,true),/Invalid response filter/);
  assert.throws(() => responseRequest('x'.repeat(101),null,{}),/Invalid response filter/);
  for(const input of [null,[],{view:'unknown'},{history:true},{worker_id:'worker-14'},{pageSize:51},{page:0},{page:5001}]) assert.throws(() => workerInboxFilters(input),/Invalid response filter/);
});

test('SQLite exact worker receipt lookup is private, read-only, scoped and accepts history but not staging',async()=>{
  const db=openDatabase(':memory:'),root=await mkdtemp(join(tmpdir(),'understood-receipt-lookup-'));
  const server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo',audioRoot:root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>(await fetch(base+'/demo/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({principal})})).headers.get('set-cookie').split(';')[0];
  try{
    const typedId=randomUUID(),helpId=randomUUID(),audioId=randomUUID();
    const typed=submitAnswer(db,worker,'assignment-30',typedId,'Finished blue; unfinished yellow.');
    requestHelp(db,worker,'assignment-30',{requestId:helpId,text:'Synthetic help text'});
    db.prepare("UPDATE clarifications SET status='resolved',notes='Private supervisor notes' WHERE id=?").run(helpId);
    const audio=await receiveRecording(db,worker,'assignment-30',audioId,wav(),root);
    db.prepare("UPDATE recordings SET status='failed',error='Private provider error' WHERE id=?").run(audio.id);
    const stagingId=randomUUID();
    const staged=await receiveRecording(db,worker,'assignment-30',stagingId,wav(),root);
    db.prepare('DELETE FROM submission_receipts WHERE submission_id=?').run(stagingId);
    db.prepare("UPDATE recordings SET status='storing',received_at=NULL WHERE id=?").run(staged.id);
    db.prepare("UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'").run();
    const own=await login('worker-30'),other=await login('worker-14'),staffCookie=await login('maya');
    const context=(await (await fetch(base+'/session',{headers:{cookie:own}})).json()).clientContext;
    const tables=['attempts','submission_receipts','clarifications','help_requests','recordings','assignments','publications','audit'];
    const snapshot=()=>JSON.stringify(tables.map(name=>db.prepare('SELECT * FROM '+name+' ORDER BY 1').all()));const before=snapshot();
    for(const [kind,requestId,id] of [['answer',typedId,typed.id],['help',helpId,helpId],['audio',audioId,audio.id]]){
      const path=`/worker/briefings/assignment-30/receipts/${kind}/${requestId}`;
      const response=await fetch(base+path,{headers:{cookie:own,'x-client-session-context':context}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const row=checkedWorkerReceipt(await response.json(),kind,{requestId,assignmentId:'assignment-30',clientContext:context});assert.equal(row.id,id);assert.equal(row.duplicate,true);
      assert.ok(!/"(?:notes|text|rubric|sha256|storage|provider|error|sequence|token)"/.test(JSON.stringify(row)));
      assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path,{headers:{cookie:staffCookie}})).status,403);
      assert.equal((await fetch(base+path,{headers:{cookie:other}})).status,404);
      assert.equal((await fetch(base+path+'?org_id=other',{headers:{cookie:own}})).status,400);
      assert.equal((await fetch(base+path,{headers:{cookie:own,'x-client-session-context':'f'.repeat(64)}})).status,409);
    }
    assert.equal(workerRequestReceipt(db,worker,'assignment-30','help',helpId).status,'resolved');
    assert.equal(workerRequestReceipt(db,worker,'assignment-30','audio',audioId).status,'failed');
    for(const [kind,id] of [['audio',stagingId],['answer',audioId],['audio',typedId],['help',typedId],['answer',randomUUID()]])assert.throws(()=>workerRequestReceipt(db,worker,'assignment-30',kind,id),/Response unavailable/);
    for(const [assignment,kind,id] of [['','answer',typedId],['x'.repeat(101),'answer',typedId],['assignment-30','other',typedId],['assignment-30','answer','bad']])assert.throws(()=>workerRequestReceipt(db,worker,assignment,kind,id),/Invalid response filter/);
    for(const invalid of [staff,{...worker,principal_id:'worker-14'},{...worker,site_id:'tripoli'},{...worker,org_id:'harbor'},{...worker,access_mode:'credential',grant_id:'revoked'},{...worker,access_mode:'demo',token_hash:'f'.repeat(64)}])assert.throws(()=>workerRequestReceipt(db,invalid,'assignment-30','answer',typedId),/Forbidden|Response unavailable|Sign in required/);
    assert.equal(snapshot(),before);
    db.prepare("UPDATE workers SET active=0 WHERE id='worker-30'").run();assert.equal((await fetch(base+`/worker/briefings/assignment-30/receipts/answer/${typedId}`,{headers:{cookie:own}})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();await rm(root,{recursive:true,force:true});}
});

test('SQLite worker inbox pages all assigned versions with exact scoped todo/sent totals',async () => {
  const db=openDatabase(':memory:'),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo'});
  const root=await mkdtemp(join(tmpdir(),'understood-inbox-test-'));
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const snapshot=db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json;
    for(let i=0;i<125;i++) {
      const suffix=String(i).padStart(3,'0'),stamp='2026-01-01T00:00:00.000Z';
      db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?)').run(`inbox-${suffix}`,'cedar','beirut','shelf',100+i,snapshot,stamp,i<120 ? 'superseded' : 'published');
      db.prepare('INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?)').run(`inbox-assignment-${suffix}`,'cedar','beirut',`inbox-${suffix}`,'worker-30',i===122 ? '2000-01-01T00:00:00.000Z' : null,stamp,'ur');
    }
    submitAnswer(db,worker,'assignment-30',randomUUID(),'Finished blue; unfinished yellow.');
    const recording=await receiveRecording(db,worker,'inbox-assignment-124',randomUUID(),wav(),root);
    db.prepare("UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'").run();
    db.prepare("UPDATE workers SET language='en' WHERE id='worker-30'").run();
    const before=db.prepare('SELECT * FROM submission_receipts ORDER BY sequence').all(),audit=db.prepare('SELECT COUNT(*) n FROM audit').get().n;
    let result=workerBriefings(db,worker,{page:7,pageSize:20},true);
    assert.equal(result.total,126);assert.equal(result.items.length,6);assert.deepEqual(result.counts,{todo:3,sent:2,history:126,followup:0});
    assert.equal(result.items.at(-1).id,'inbox-assignment-000');assert.equal(result.items[0].language,'ur');assert.ok(!/"(rubric|source|facts|question|reasons|notes|answer_text|snapshot|sequence|storage)"\s*:/.test(JSON.stringify(result)));assert.match(result.items[0].responseMode,/^(question|acknowledgment)$/);
    result=workerBriefings(db,worker,{view:'todo',pageSize:1});assert.equal(result.total,3);assert.equal(result.items.length,1);
    assert.ok(!['inbox-assignment-122','inbox-assignment-124','assignment-30'].includes(result.items[0].id));
    result=workerBriefings(db,worker,{view:'sent'});assert.equal(result.total,2);assert.equal(result.items[0].state,'withdrawn');assert.equal(result.items[1].audioStatus,'received');
    db.prepare("UPDATE recordings SET status='failed' WHERE id=?").run(recording.id);
    result=workerBriefings(db,worker,{view:'sent'});assert.equal(result.total,2);assert.equal(result.items[1].audioStatus,'failed');
    assert.equal(workerBriefings(db,worker,{page:5000},true).items.length,0);
    assert.equal(workerBriefings(db,worker).total,5);
    assert.equal(staffWorkerAssignments(db,staff,'worker-30',{page:7,pageSize:20}).total,126);
    for(const session of [staff,{...worker,principal_id:'worker-14',site_id:'tripoli'},{...worker,principal_id:'missing'},{...worker,access_mode:'credential',grant_id:'revoked'}]) assert.throws(() => workerBriefings(db,session),/Forbidden/);
    const login=await fetch(`${base}/demo/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({principal:'worker-30'})}),cookie=login.headers.get('set-cookie').split(';')[0];
    for(const query of ['?view=unknown','?pageSize=51','?worker_id=worker-14','?history=true']) assert.equal((await fetch(`${base}/worker/history${query}`,{headers:{cookie}})).status,400);
    const http=await (await fetch(`${base}/worker/history?page=7&pageSize=20`,{headers:{cookie}})).json();assert.equal(http.total,126);assert.equal(http.items.length,6);
    assert.equal((await (await fetch(`${base}/worker/briefings?view=sent`,{headers:{cookie}})).json()).total,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n,audit);assert.deepEqual(db.prepare('SELECT * FROM submission_receipts ORDER BY sequence').all(),before);
    db.prepare("UPDATE workers SET active=0 WHERE id='worker-30'").run();assert.throws(() => workerBriefings(db,worker),/Forbidden/);
  } finally {await new Promise((resolve) => server.close(resolve));db.close();await rm(root,{recursive:true,force:true});}
});

test('SQLite response history is scoped, receipt-ordered, paged and read-only across withdrawal',async () => {
  const db=openDatabase(':memory:'),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'demo'});
  const root=await mkdtemp(join(tmpdir(),'understood-response-test-'));
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,cookie,body) => fetch(`${base}/api${path}`,{method:body ? 'POST' : 'GET',headers:{...(cookie ? {cookie} : {}),'content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
  const login=async (principal) => (await request('/demo/session',null,{principal})).headers.get('set-cookie').split(';')[0];
  try {
    const maya=await login('maya'),workerCookie=await login('worker-30'),foreign=await login('harbor-owner');
    const path='/publications/shelf-v3/responses';
    const directoryPath='/people/workers/worker-30/assignments';
    assert.equal((await request(directoryPath)).status,401);assert.equal((await request(directoryPath,workerCookie)).status,403);
    assert.equal((await request(directoryPath,foreign)).status,404);assert.equal((await request('/people/workers/missing/assignments',maya)).status,404);
    for(const query of ['?org_id=harbor','?pageSize=51','?language=all','?status=all']) assert.equal((await request(`${directoryPath}${query}`,maya)).status,400);
    assert.equal((await request(path)).status,401);assert.equal((await request(path,workerCookie)).status,403);assert.equal((await request(path,foreign)).status,404);
    assert.equal((await request(`${path}/assignment-30`,foreign)).status,404);assert.equal((await request(`${path}/missing`,maya)).status,404);
    for(const query of ['?org_id=harbor','?pageSize=51','?language=xyz','?status=resolved']) assert.equal((await request(`${path}${query}`,maya)).status,400);
    assert.equal((await request(`${path}/assignment-30?status=all`,maya)).status,400);
    let page=listPublicationResponses(db,staff,'shelf-v3');assert.equal(page.total,30);assert.equal(page.items.length,20);
    page=listPublicationResponses(db,staff,'shelf-v3',{page:2});assert.equal(page.items.length,10);
    page=listPublicationResponses(db,staff,'shelf-v3',{search:'030'});assert.equal(page.total,1);assert.equal(page.items[0].status,'awaiting_response');
    assert.ok(!/answerText|rubric|reasons|storage|facts|question/.test(JSON.stringify(page)));
    submitAnswer(db,worker,'assignment-30',randomUUID(),'Finished blue; unfinished yellow.');
    const audio=await receiveRecording(db,worker,'assignment-30',randomUUID(),wav(),root);
    assert.equal(listPublicationResponses(db,staff,'shelf-v3',{status:'assessment_pending'}).items.find((row) => row.assignmentId==='assignment-30').outcome,null);
    db.prepare("UPDATE recordings SET status='failed' WHERE id=?").run(audio.id);
    assert.equal(listPublicationResponses(db,staff,'shelf-v3',{search:'030'}).items[0].status,'failed_audio');
    assert.equal(staffWorkerAssignments(db,staff,'worker-30').items[0].status,'failed_audio');
    submitAnswer(db,worker,'assignment-30',randomUUID(),'Finished blue; unfinished yellow.');
    // Receipt order, not client timestamps, controls the latest response.
    db.prepare("UPDATE attempts SET received_at='2000-01-01T00:00:00Z' WHERE assignment_id='assignment-30'").run();
    const before=db.prepare("SELECT * FROM submission_receipts WHERE assignment_id='assignment-30' ORDER BY sequence").all();
    let own=workerSubmissions(db,worker,'assignment-30',{pageSize:1});assert.equal(own.total,3);assert.equal(own.receipts[0].isLatest,true);assert.equal(own.receipts[0].outcome,'matched');
    assert.deepEqual(Object.keys(own.receipts[0]).sort(),['id','kind','receivedAt','isLatest','answerText','outcome','recordingId','audioStatus'].sort());
    assert.ok(!/rubric|facts|reasons|evidence|notes|sequence|storage|sha256/.test(JSON.stringify(own)));
    own=workerSubmissions(db,worker,'assignment-30',{page:2,pageSize:1});assert.equal(own.receipts[0].recordingId,audio.id);assert.equal(own.receipts[0].isLatest,false);
    assert.throws(() => workerSubmissions(db,staff,'assignment-30'),/Forbidden/);
    assert.throws(() => workerSubmissions(db,{...worker,access_mode:'credential',grant_id:'revoked'},'assignment-30'),/Forbidden/);
    assert.throws(() => workerSubmissions(db,worker,'assignment-14'),/Response unavailable/);
    assert.equal((await request('/worker/briefings/assignment-30/submissions',maya)).status,403);
    assert.equal((await request('/worker/briefings/assignment-14/submissions',workerCookie)).status,404);
    assert.equal((await request('/worker/briefings/assignment-30/submissions?org_id=harbor',workerCookie)).status,400);
    let detail=getPublicationResponse(db,staff,'shelf-v3','assignment-30',{pageSize:1});
    assert.equal(detail.total,3);assert.equal(detail.receipts[0].isLatest,true);assert.equal(detail.receipts[0].outcome,'matched');
    assert.equal(detail.assignment.language,'ur');assert.equal(detail.facts.length,3);
    detail=getPublicationResponse(db,staff,'shelf-v3','assignment-30',{page:2,pageSize:1});assert.equal(detail.receipts[0].recordingId,audio.id);assert.equal(detail.receipts[0].isLatest,false);
    detail=getPublicationResponse(db,staff,'shelf-v3','assignment-30',{page:3,pageSize:1});assert.equal(detail.receipts[0].kind,'typed');
    detail=getPublicationResponse(db,staff,'shelf-v3','assignment-30',{page:5000});assert.equal(detail.receipts.length,0);assert.equal(detail.total,3);
    assert.throws(() => getPublicationResponse(db,worker,'shelf-v3','assignment-30'),/Forbidden/);
    assert.throws(() => getPublicationResponse(db,{...staff,role:'auditor'},'shelf-v3','assignment-30'),/Forbidden/);
    db.prepare("INSERT INTO staff VALUES('reader','cedar','beirut','Reader','auditor',1)").run();
    assert.equal(getPublicationResponse(db,{...staff,principal_id:'reader',role:'auditor'},'shelf-v3','assignment-30').total,3);
    assert.throws(() => staffWorkerAssignments(db,{...staff,principal_id:'reader',role:'auditor'},'worker-30'),/Forbidden/);
    for(const session of [{...staff,principal_id:'missing'},{...staff,site_id:'tripoli'},{...staff,org_id:'harbor'},worker]) assert.throws(() => staffWorkerAssignments(db,session,'worker-30'),/Forbidden/);
    withdrawPublication(db,staff,'shelf',{requestId:randomUUID(),publicationId:'shelf-v3',version:3,reason:'Read-only history test'});
    const count=db.prepare('SELECT COUNT(*) n FROM audit').get().n;
    const read=await (await request(`${path}/assignment-30`,maya)).json();assert.equal(read.publication.state,'withdrawn');assert.equal(read.receipts.length,3);
    assert.equal((await (await request(path,maya)).json()).total,30);
    const ownHttp=await (await request('/worker/briefings/assignment-30/submissions?pageSize=1',workerCookie)).json();assert.equal(ownHttp.assignment.state,'withdrawn');assert.equal(ownHttp.total,3);assert.equal(ownHttp.receipts.length,1);
    const workerSession=await (await request('/session',workerCookie)).json();assert.equal(ownHttp.clientContext,workerSession.clientContext);
    assert.equal((await fetch(base+'/api/worker/briefings/assignment-30/submissions',{headers:{cookie:workerCookie,'x-client-session-context':'f'.repeat(64)}})).status,409);
    assert.ok(!/reasons|evidence|notes|facts|rubric|sequence/.test(JSON.stringify(ownHttp)));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit').get().n,count);
    assert.deepEqual(db.prepare("SELECT * FROM submission_receipts WHERE assignment_id='assignment-30' ORDER BY sequence").all(),before);
    db.prepare("UPDATE briefings SET state='ready',prepared_json=(SELECT snapshot_json FROM publications WHERE id='shelf-v3') WHERE id='shelf'").run();
    const newPublication=publish(db,staff,'shelf',{requestId:randomUUID(),revision:1,nextVersion:4,workerIds:['worker-30']});
    db.prepare("UPDATE workers SET language='en',active=0 WHERE id='worker-30'").run();
    const frozen=db.prepare("SELECT * FROM assignments WHERE worker_id='worker-30' ORDER BY id").all();
    const directory=staffWorkerAssignments(db,staff,'worker-30',{pageSize:1});
    assert.equal(directory.worker.active,false);assert.equal(directory.total,2);assert.equal(directory.items.length,1);
    assert.equal(directory.items[0].publicationId,newPublication.id);assert.equal(directory.items[0].language,'ur');assert.equal(directory.items[0].status,'awaiting_response');
    const older=staffWorkerAssignments(db,staff,'worker-30',{page:2,pageSize:1});assert.equal(older.items[0].state,'withdrawn');assert.equal(older.items[0].status,'matched');
    assert.equal(older.items[0].assignmentId,'assignment-30');assert.equal(older.items[0].title,'Shelf colour handover');assert.equal(older.items[0].language,'ur');
    assert.ok(!/answerText|rubric|question|facts|reasons|storage|notes|sha256/.test(JSON.stringify(older)));
    const empty=staffWorkerAssignments(db,staff,'worker-30',{page:5000});assert.equal(empty.total,2);assert.equal(empty.items.length,0);
    assert.equal((await (await request(`${directoryPath}?page=2&pageSize=1`,maya)).json()).items[0].publicationId,'shelf-v3');
    assert.deepEqual(db.prepare("SELECT * FROM assignments WHERE worker_id='worker-30' ORDER BY id").all(),frozen);
  } finally {await new Promise((resolve) => server.close(resolve));db.close();await rm(root,{recursive:true,force:true});}
});
