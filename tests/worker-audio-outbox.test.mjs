import test from 'node:test';
import assert from 'node:assert/strict';
import {audioOutboxKey,readAudioOutbox,clearAudioOutbox,saveAudioDraft,AudioDraftError} from '../src/worker-audio-draft.ts';
import {encodeWav} from '../src/audio.ts';

const time=Date.parse('2026-10-10T12:00:00.000Z'),now=()=>time;
const session={authenticated:true,role:'worker',workerId:'synthetic-one',language:'en',mode:'synthetic-credential',clientContext:'a'.repeat(64),expiresAt:'2026-10-10T20:00:00.000Z'};
const scope={assignmentId:'private-assignment-one',publicationId:'version-three',version:3,language:'en'};
const bytes=encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*.5)});
const input=()=>({submissionId:crypto.randomUUID(),capturedAt:new Date(time).toISOString(),bytes});
function memory(){
  const rows=new Map();
  return {rows,async entries(){return structuredClone([...rows].map(([key,value])=>({key,value})));},slot(key){return {
    async read(){return structuredClone(rows.get(key)??null);},
    async replace(revision,value,allowed){if(!allowed() || (rows.get(key)?.revision??null)!==revision)return false;if(value)rows.set(key,structuredClone(value));else rows.delete(key);return true;},
    async clear(){rows.delete(key);},
  };},async clear(context){for(const [key,value] of rows)if(!context || value.context===context)rows.delete(key);}};
}
test('queue recovers multiple exact scopes and legacy recording without plaintext key metadata or overwriting',async()=>{
  const collection=memory(),first=input(),second=input(),other={...scope,assignmentId:'other-private-assignment',language:'ar'};
  const key=await audioOutboxKey(other.assignmentId);assert.match(key,/^assignment:[a-f0-9]{64}$/);assert.ok(!key.includes(other.assignmentId));
  await saveAudioDraft(collection.slot('pending'),session,scope,first,true,()=>true,now);
  await saveAudioDraft(collection.slot(key),session,other,second,true,()=>true,now);
  const items=await readAudioOutbox(session,()=>true,collection,now);assert.equal(items.length,2);
  assert.deepEqual(items.map(item=>item.draft.submissionId).sort(),[first.submissionId,second.submissionId].sort());
  assert.deepEqual(items[0].draft.bytes,bytes);assert.equal(collection.rows.size,2);
  await assert.rejects(saveAudioDraft(collection.slot(key),session,other,input(),true,()=>true,now),error=>error.code==='other');
  await collection.slot(key).clear();assert.equal((await readAudioOutbox(session,()=>true,collection,now))[0].draft.submissionId,first.submissionId);
});
test('inventory removes expired and foreign-context entries without exposing payloads; session fence aborts reads',async()=>{
  const early={...session,expiresAt:new Date(time+86400000*2).toISOString()};
  const collection=memory();await saveAudioDraft(collection.slot('pending'),early,scope,input(),true,()=>true,now);
  assert.equal((await readAudioOutbox(early,()=>true,collection,()=>time+86400000+1)).length,0);assert.equal(collection.rows.size,0);
  await saveAudioDraft(collection.slot('pending'),early,scope,input(),true,()=>true,now);
  assert.deepEqual(await readAudioOutbox({...early,clientContext:'b'.repeat(64)},()=>true,collection,now),[]);assert.equal(collection.rows.size,0);
  await assert.rejects(readAudioOutbox(session,()=>false,collection,now),error=>error.code==='session');
});
test('mismatched slot binding or corrupt ciphertext fails closed, while explicit purge can remove corruption',async()=>{
  const collection=memory();await saveAudioDraft(collection.slot(await audioOutboxKey('wrong')),session,scope,input(),true,()=>true,now);
  await assert.rejects(readAudioOutbox(session,()=>true,collection,now),error=>error.code==='invalid');
  await clearAudioOutbox(session.clientContext,collection);assert.equal(collection.rows.size,0);
  await saveAudioDraft(collection.slot('pending'),session,scope,input(),true,()=>true,now);
  new Uint8Array(collection.rows.get('pending').ciphertext)[0]^=255;
  await assert.rejects(readAudioOutbox(session,()=>true,collection,now),error=>error.code==='invalid');
  await clearAudioOutbox(undefined,collection);assert.equal(collection.rows.size,0);
});
test('context purge preserves other worker data and verifies every queued slot rather than just legacy slot',async()=>{
  const collection=memory(),key=await audioOutboxKey(scope.assignmentId);
  await saveAudioDraft(collection.slot(key),session,scope,input(),true,()=>true,now);
  await saveAudioDraft(collection.slot('pending'),{...session,clientContext:'b'.repeat(64)},scope,input(),true,()=>true,now);
  await assert.rejects(clearAudioOutbox(session.clientContext,{...collection,clear:async()=>{}}),error=>error instanceof AudioDraftError && error.code==='storage');
  await clearAudioOutbox(session.clientContext,collection);assert.equal(collection.rows.size,1);assert.ok(collection.rows.has('pending'));
  await clearAudioOutbox(undefined,collection);assert.equal(collection.rows.size,0);
});
