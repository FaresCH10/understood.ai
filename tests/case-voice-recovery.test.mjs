import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readVoicePending,retainVoice,checkedVoiceReceipt,clearVoicePending} from '../src/case-voice-recovery.ts';
import {conversationRecordingNotice} from '../src/recording-notice.ts';
import {WORKER_LOCALES} from '../server/languages.mjs';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('voice recovery keeps only context-bound metadata and requires the exact recording and receipt',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const session={clientContext:'d'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()},scope={kind:'help',id:'assignment-14'},bytes=new Uint8Array(8044).fill(10),id=randomUUID();
  const pending=await retainVoice(storage,session,scope,id,bytes);assert.deepEqual(readVoicePending(storage,session,scope),pending);assert.deepEqual(await retainVoice(storage,session,scope,id,bytes),pending);
  assert.equal(JSON.stringify([...values]).includes('bytes'),false);assert.equal(readVoicePending(storage,{...session,clientContext:'e'.repeat(64)},scope),null);
  assert.equal(readVoicePending(storage,session,{kind:'reply',id:scope.id,assignmentId:scope.id}),null);
  await assert.rejects(retainVoice(storage,session,scope,randomUUID(),bytes),/pending/);await assert.rejects(retainVoice(storage,session,scope,id,new Uint8Array(8044)),/pending/);
  const receipt={id,caseId:id,assignmentId:scope.id,kind:'help',sha256:pending.hash,status:'received',createdAt:new Date().toISOString(),receivedAt:new Date().toISOString()};
  assert.deepEqual(checkedVoiceReceipt(receipt,scope,pending),receipt);
  for(const bad of [null,{}, {...receipt,sha256:'a'.repeat(64)}, {...receipt,assignmentId:'foreign'}, {...receipt,caseId:randomUUID()}, {...receipt,kind:'reply'}, {...receipt,status:'unknown'}, {...receipt,receivedAt:null}])assert.throws(()=>checkedVoiceReceipt(bad,scope,pending));
  assert.throws(()=>clearVoicePending(storage,session,scope,randomUUID()),/changed/);clearVoicePending(storage,session,scope,id);assert.equal(readVoicePending(storage,session,scope),null);
  await assert.rejects(retainVoice({...storage,setItem(){}},session,scope,id,bytes),/Nothing was sent/);
  assert.throws(()=>readVoicePending(storage,{...session,expiresAt:'2000-01-01'},scope),/session/);
});

test('conversation recording notices disclose private storage and explicitly exclude AI processing',()=>{
  const notices=Object.fromEntries(WORKER_LOCALES.map(({code})=>[code,conversationRecordingNotice(code)]));
  assertWorkerDictionary(notices,'conversationRecordingNotice');
  for(const notice of Object.values(notices))assert.equal(Object.keys(notice).length,5);
  assert.match(conversationRecordingNotice('en').processing,/not submitted as answers or sent to an AI provider/);
  assert.doesNotMatch(conversationRecordingNotice('en').local,/save a copy/);
});

test('voice recovery cannot write a new namespace after hashing-time scope, context or authority changes',async()=>{
  const values=new Map(),store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},bytes=new Uint8Array(8044);
  for(const changed of ['scope','assignment','context','expiry','authority']){
    const session={clientContext:'f'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()},scope={kind:'reply',id:'case-14',assignmentId:'assignment-14'};let current=true;
    const retained=retainVoice(store,session,scope,randomUUID(),bytes,()=>current);
    if(changed==='scope')scope.id='other';if(changed==='assignment')scope.assignmentId='other';if(changed==='context')session.clientContext='e'.repeat(64);
    if(changed==='expiry')session.expiresAt='2000-01-01T00:00:00.000Z';if(changed==='authority')current=false;
    await assert.rejects(retained,/session unavailable/);assert.equal(values.size,0);
  }
});
