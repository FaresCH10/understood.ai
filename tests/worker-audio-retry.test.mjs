import test from 'node:test';
import assert from 'node:assert/strict';
import {sendWorkerRecording,WorkerAudioRetryError,workerAudioRetryText} from '../src/worker-audio-retry.ts';
import {createRecordingSubmission} from '../src/audio.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

const session={authenticated:true,role:'worker',workerId:'qa-one',language:'en',mode:'synthetic-demo',clientContext:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00.000Z'};
const scope={assignmentId:'assignment-one',publicationId:'publication-one',version:3,language:'en'};
const id='8deac46b-26eb-4cb3-9c4c-f3d03fdf7753';
const receipt={id:'3b4ea3e1-fc77-4efb-9c60-36521ac5b5a7',requestId:id,assignmentId:scope.assignmentId,clientContext:session.clientContext,status:'received',receivedAt:'2026-10-07T12:00:00.000Z',duplicate:false};
const detail={id:scope.assignmentId,publicationId:scope.publicationId,version:3,language:'en',state:'published',dueAt:null,outcome:null,audioStatus:null};
const bytes=new Uint8Array(32044);
const fail=code=>error=>error instanceof WorkerAudioRetryError && error.code===code;
function fixture(overrides={}) {
  const requests=[];
  const send=async(path,options)=>{
    requests.push({path,options});
    if(path==='/api/session')return overrides.session?.(options) ?? Response.json(session);
    if(path.includes('/receipts/'))return overrides.receipt?.(options) ?? new Response(null,{status:404});
    if(path.endsWith('/audio'))return overrides.upload?.(options) ?? Response.json(receipt,{status:201});
    return overrides.detail?.(options) ?? Response.json(detail);
  };
  return {send,requests};
}

test('new audio performs session, receipt and exact assignment reads before a bounded identity-bound POST',async()=>{
  const {send,requests}=fixture();
  assert.equal((await sendWorkerRecording(send,session,scope,bytes,id)).id,receipt.id);
  assert.deepEqual(requests.map(value=>[value.path,value.options.method]),[
    ['/api/session','GET'],[`/api/worker/briefings/assignment-one/receipts/audio/${id}`,'GET'],
    ['/api/worker/briefings/assignment-one','GET'],['/api/worker/briefings/assignment-one/audio','POST'],
  ]);
  for(const {options} of requests){assert.equal(options.cache,'no-store');assert.equal(options.credentials,'include');assert.equal(options.headers['x-client-session-context'],session.clientContext);assert.ok(options.signal instanceof AbortSignal);}
  assert.equal(requests[3].options.headers['x-submission-id'],id);
  assert.deepEqual(new Uint8Array(await requests[3].options.body.arrayBuffer()),bytes);
});

test('a bound translated-question id is carried only as a validated upload header',async()=>{
  const presentationId=crypto.randomUUID(),{send,requests}=fixture();
  assert.equal((await sendWorkerRecording(send,session,scope,bytes,id,()=>true,presentationId)).id,receipt.id);
  assert.equal(requests[3].options.headers['x-presentation-id'],presentationId);
  const plain=fixture();await sendWorkerRecording(plain.send,session,scope,bytes,id);
  assert.equal('x-presentation-id' in plain.requests[3].options.headers,false);
  for(const bad of ['',`presentation-${id}`,'bad',crypto.randomUUID().toUpperCase(),1]){
    const rejected=fixture();
    await assert.rejects(sendWorkerRecording(rejected.send,session,scope,bytes,id,()=>true,bad),fail('input'));
    assert.equal(rejected.requests.length,0);
  }
});

test('a changed interface preference does not replace or block the frozen assignment language',async()=>{
  const preferred={...session,language:'ar'};
  const {send,requests}=fixture({session:()=>Response.json(preferred)});
  assert.equal((await sendWorkerRecording(send,preferred,scope,bytes,id)).id,receipt.id);
  assert.equal(requests.length,4);assert.equal(requests[3].options.method,'POST');
});

test('accepted receipt after an uncertain upload ends retry without a second POST or closed-publication read',async()=>{
  const samples=Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*.5);
  let decodes=0,accepted=false,posts=0,payload;
  const submission=createRecordingSubmission(new Blob(['synthetic only']),id,async()=>{decodes++;return {duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples};});
  const {send,requests}=fixture({
    receipt:()=>accepted ? Response.json({...receipt,duplicate:true,status:'failed'}) : new Response(null,{status:404}),
    upload:async options=>{posts++;payload=new Uint8Array(await options.body.arrayBuffer());accepted=true;throw Error('Acknowledgement lost after acceptance');},
    detail:()=>{assert.equal(accepted,false);return Response.json(detail);},
  });
  const first=await submission.bytes();
  await assert.rejects(sendWorkerRecording(send,session,scope,first,id),fail('receipt'));
  first.fill(0);samples.fill(0);
  const result=await sendWorkerRecording(send,session,scope,await submission.bytes(),id);
  assert.equal(result.id,receipt.id);assert.equal(result.status,'failed');
  assert.equal(decodes,1);assert.equal(posts,1);
  assert.deepEqual(await submission.bytes(),payload);
  assert.equal(requests.filter(value=>value.path.endsWith('/assignment-one')).length,1);
});

test('receipt failure, malformed identity and permission failures cannot proceed to upload',async()=>{
  for(const status of [401,403,409,500,503]) {
    const {send,requests}=fixture({receipt:()=>new Response(null,{status})});
    await assert.rejects(sendWorkerRecording(send,session,scope,bytes,id),fail('unavailable'));
    assert.equal(requests.length,2);
  }
  for(const value of [{...receipt,requestId:crypto.randomUUID()},{...receipt,assignmentId:'foreign'},{...receipt,clientContext:'b'.repeat(64)},{...receipt,receivedAt:null},{...receipt,rubric:'private'}]) {
    const {send,requests}=fixture({receipt:()=>Response.json(value)});
    await assert.rejects(sendWorkerRecording(send,session,scope,bytes,id),fail('unavailable'));assert.equal(requests.length,2);
  }
});

test('changed worker, context, language, expiry and in-flight locks fail before audio upload',async()=>{
  for(const value of [{...session,workerId:'foreign'},{...session,clientContext:'b'.repeat(64)},{...session,language:'ar'},{...session,expiresAt:'2098-01-01T00:00:00.000Z'},{authenticated:false}]) {
    const {send,requests}=fixture({session:()=>Response.json(value)});
    await assert.rejects(sendWorkerRecording(send,session,scope,bytes,id),fail('session'));assert.equal(requests.length,1);
  }
  const current={...session};const changed=fixture({receipt:()=>{current.clientContext='b'.repeat(64);return new Response(null,{status:404});}});
  await assert.rejects(sendWorkerRecording(changed.send,current,scope,bytes,id),fail('session'));assert.equal(changed.requests.length,2);
  let unlocked=true;const locked=fixture({detail:()=>{unlocked=false;return Response.json(detail);}});
  await assert.rejects(sendWorkerRecording(locked.send,session,scope,bytes,id,()=>unlocked),fail('session'));assert.equal(locked.requests.length,3);
  const expired=fixture();await assert.rejects(sendWorkerRecording(expired.send,{...session,expiresAt:'2000-01-01T00:00:00.000Z'},scope,bytes,id),fail('session'));assert.equal(expired.requests.length,0);
});

test('fresh version, assignment, language, deadline and response conflicts fail without POST',async()=>{
  for(const value of [{...detail,id:'foreign'},{...detail,publicationId:'other'},{...detail,version:4},{...detail,language:'ar'},{...detail,state:'withdrawn'},{...detail,dueAt:'2000-01-01T00:00:00.000Z'},{...detail,dueAt:'bad'},{...detail,outcome:'matched'},{...detail,audioStatus:'received'},{...detail,assessmentStatus:'pending'},null]) {
    const {send,requests}=fixture({detail:()=>Response.json(value)});
    await assert.rejects(sendWorkerRecording(send,session,scope,bytes,id),fail('conflict'));assert.equal(requests.length,3);
  }
  for(const status of [403,404,409,410,500,503]) {
    const {send,requests}=fixture({detail:()=>new Response(null,{status})});
    await assert.rejects(sendWorkerRecording(send,session,scope,bytes,id),fail(status>=500?'unavailable':'conflict'));assert.equal(requests.length,3);
  }
});

test('pending bytes and scope are frozen across reads, and unverifiable POST responses remain uncertain',async()=>{
  const input=new Uint8Array(bytes),originalScope={...scope};
  const {send,requests}=fixture({session:()=>{input.fill(255);originalScope.publicationId='changed';return Response.json(session);}});
  await sendWorkerRecording(send,session,originalScope,input,id);
  assert.deepEqual(new Uint8Array(await requests[3].options.body.arrayBuffer()),bytes);
  for(const value of [{...receipt,id:'bad'},{...receipt,assignmentId:'foreign'},{...receipt,duplicate:null},{...receipt,receivedAt:'bad'}]) {
    const broken=fixture({upload:()=>Response.json(value)});
    await assert.rejects(sendWorkerRecording(broken.send,session,scope,bytes,id),fail('receipt'));
  }
  for(const status of [401,403,409,500,503]) {
    const broken=fixture({upload:()=>new Response(null,{status})});
    await assert.rejects(sendWorkerRecording(broken.send,session,scope,bytes,id),fail('receipt'));
  }
});

test('invalid recording identities and payload bounds are rejected before any request; all recovery copy is localized',async()=>{
  const {send,requests}=fixture();
  for(const args of [[scope,new Uint8Array(0),id],[scope,new Uint8Array(2880046),id],[scope,new Uint8Array(8045),id],[scope,bytes,'bad'],[{...scope,version:0},bytes,id],[{...scope,assignmentId:''},bytes,id],[{...scope,publicationId:''},bytes,id],[{...scope,language:'xyz'},bytes,id]])await assert.rejects(sendWorkerRecording(send,session,...args),fail('input'));
  assert.equal(requests.length,0);
  assertWorkerDictionary(workerAudioRetryText,'workerAudioRetryText');
  assert.deepEqual(Object.keys(workerAudioRetryText.en).sort(),['conflict','input','receipt','session','unavailable']);
  for(const copy of Object.values(workerAudioRetryText))for(const value of Object.values(copy))assert.ok(value.trim().length>20);
});
