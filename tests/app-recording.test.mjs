import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {randomUUID} from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createAppServer } from '../server/index.mjs';
import {checkedWorkerReceipt} from '../src/worker-request.ts';
import {createRecordingSubmission} from '../src/audio.ts';
import {sendWorkerRecording,WorkerAudioRetryError} from '../src/worker-audio-retry.ts';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); bytes.writeInt16LE(1000, 44);
  return bytes;
}

test('session middleware binds voice upload and private playback to the assignment', async () => {
  const db = openDatabase(':memory:');
  const audioRoot = await mkdtemp(join(tmpdir(), 'understood-app-recording-'));
  const server = sqliteApp(db,{audioRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const signIn = async (principal) => {
    const response = await loginPrincipal(base, principal);
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try {
    const own = await signIn('worker-29');
    const other = await signIn('worker-14');
    const staff = await signIn('maya');
    const context=await (await fetch(`${base}/session`,{headers:{cookie:own}})).json();
    const foreign=await (await fetch(`${base}/session`,{headers:{cookie:other}})).json();
    const upload = (clientContext=context.clientContext) => fetch(`${base}/worker/briefings/assignment-29/audio`, {
      method: 'POST', headers: { cookie: own, 'content-type': 'audio/wav', 'x-submission-id': '3b4ea3e1-fc77-4efb-9c60-36521ac5b5a7',...(clientContext===null ? {} : {'x-client-session-context':clientContext}) }, body: wav(),
    });
    assert.match(context.clientContext,/^[a-f0-9]{64}$/);assert.ok(Date.parse(context.expiresAt)>Date.now());
    assert.equal((await upload(null)).status,409);assert.equal((await upload(foreign.clientContext)).status,409);
    assert.equal(db.prepare('SELECT count(*) AS n FROM recordings').get().n,0);
    const first = await upload();
    assert.equal(first.status, 201);
    const expected={requestId:'3b4ea3e1-fc77-4efb-9c60-36521ac5b5a7',assignmentId:'assignment-29',clientContext:context.clientContext};
    const receipt = checkedWorkerReceipt(await first.json(),'audio',expected);
    assert.equal(receipt.status, 'received');
    assert.equal(receipt.aiStatus, 'pending');
    const repeated=await upload();assert.equal(repeated.status,200);
    assert.equal(checkedWorkerReceipt(await repeated.json(),'audio',expected).id,receipt.id);
    assert.equal((await fetch(`${base}/recordings/${receipt.id}/audio`, { headers: { cookie: own } })).status, 200);
    assert.equal((await fetch(`${base}/recordings/${receipt.id}/audio`, { headers: { cookie: other } })).status, 404);
    assert.equal((await fetch(`${base}/recordings/${receipt.id}`, { headers: { cookie: staff } })).status, 200);
    const assignment = await (await fetch(`${base}/worker/briefings/assignment-29`, { headers: { cookie: own } })).json();
    assert.equal(assignment.audioStatus, 'received');
    assert.equal(assignment.outcome, null);
    assert.equal(JSON.stringify(assignment).includes('rubric'), false);
    const inbox = await (await fetch(`${base}/worker/briefings`, { headers: { cookie: own } })).json();
    assert.equal(inbox.items[0].audioStatus, 'received');
    const overview = await (await fetch(`${base}/overview`, { headers: { cookie: staff } })).json();
    assert.deepEqual(overview.metrics, { assigned: 30, responses: 25, matches: 21, clarifications: 3,
      unassessed: 1, pending: 5, completion: 83 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-29').n, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close(); await rm(audioRoot, { recursive: true, force: true });
  }
});

test('worker cookie rotation fences stale answers, help, reads and logout before side effects',async()=>{
  const db=openDatabase(':memory:');
  const server=sqliteApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const login=async principal=>{
    const response=await loginPrincipal(base, principal);
    assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
    const dto=await (await fetch(base+'/session',{headers:{cookie}})).json();return {cookie,context:dto.clientContext};
  };
  const post=(path,identity,body={},context=identity.context)=>fetch(base+path,{method:'POST',headers:{cookie:identity.cookie,'content-type':'application/json',...(context===null ? {} : {'x-client-session-context':context})},body:JSON.stringify(body)});
  try {
    const old=await login('worker-30'),current=await login('worker-30'),other=await login('worker-29'),staff=await login('maya');
    assert.notEqual(old.context,current.context);
    const before=db.prepare('SELECT count(*) AS n FROM attempts').get().n;
    for(const path of ['/worker/briefings/assignment-30/answers','/worker/briefings/assignment-30/help','/logout']) {
      for(const context of [null,old.context,other.context]) {
        const response=await post(path,current,{submissionId:randomUUID(),requestId:randomUUID(),text:'Synthetic stale submission'},context);
        assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'Session context changed'});
      }
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM attempts').get().n,before);
    assert.equal((await post('/logout',staff,{},old.context)).status,409);
    assert.equal((await fetch(base+'/overview',{headers:{cookie:staff.cookie}})).status,200);
    assert.equal((await fetch(base+'/worker/briefings',{headers:{cookie:other.cookie,'x-client-session-context':old.context}})).status,409);
    const help={requestId:randomUUID(),text:'Synthetic help about the shelf'};
    assert.equal((await post('/worker/briefings/assignment-30/help',current,help)).status,201);
    assert.equal((await post('/worker/briefings/assignment-30/help',current,help)).status,200);
    assert.equal((await post('/logout',current)).status,200);
    assert.equal((await post('/worker/briefings/assignment-30/help',current,help)).status,401);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('prepared audio reconciles a real lost acceptance acknowledgement without reposting after withdrawal',async()=>{
  const db=openDatabase(':memory:');
  const audioRoot=await mkdtemp(join(tmpdir(),'understood-audio-retry-'));
  const server=sqliteApp(db,{audioRoot});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const login=await loginPrincipal(base, 'worker-30');
    const cookie=login.headers.get('set-cookie').split(';')[0];
    db.prepare("UPDATE workers SET language='en' WHERE id='worker-30'").run();
    const session=await (await fetch(base+'/api/session',{headers:{cookie}})).json();
    const detail=await (await fetch(base+'/api/worker/briefings/assignment-30',{headers:{cookie}})).json();
    assert.equal(session.language,'en');assert.equal(detail.language,'ur');
    const scope={assignmentId:detail.id,publicationId:detail.publicationId,version:detail.version,language:detail.language};
    const samples=Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*.5);
    let decodes=0,posts=0,detailReads=0;
    const submission=createRecordingSubmission(new Blob(['synthetic encoded capture']),randomUUID(),async()=>{
      decodes++;return {duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples};
    });
    const send=async(path,options)=>{
      const response=await fetch(base+path,{...options,headers:{...options.headers,cookie}});
      if(path.endsWith('/assignment-30'))detailReads++;
      if(options.method==='POST'){
        posts++;assert.equal(response.status,201);await response.json();throw Error('Synthetic acknowledgement loss after commit');
      }
      return response;
    };
    await assert.rejects(sendWorkerRecording(send,session,scope,await submission.bytes(),submission.submissionId),error=>error instanceof WorkerAudioRetryError && error.code==='receipt');
    assert.equal(db.prepare('SELECT count(*) AS n FROM recordings WHERE assignment_id=?').get('assignment-30').n,1);
    const accepted=db.prepare('SELECT id,received_at FROM recordings WHERE assignment_id=?').get('assignment-30');assert.ok(accepted.received_at);
    db.prepare("UPDATE publications SET state='withdrawn' WHERE id=?").run(scope.publicationId);
    const result=await sendWorkerRecording(send,session,scope,await submission.bytes(),submission.submissionId);
    assert.equal(result.id,accepted.id);assert.equal(result.duplicate,true);
    assert.equal(posts,1);assert.equal(detailReads,1);assert.equal(decodes,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM submission_receipts WHERE assignment_id=? AND kind='audio'").get('assignment-30').n,1);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();await rm(audioRoot,{recursive:true,force:true});}
});
