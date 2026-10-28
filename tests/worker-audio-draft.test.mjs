import test from 'node:test';
import assert from 'node:assert/strict';
import {saveAudioDraft,readAudioDraft,clearAudioDraft,AudioDraftError,audioDraftCopy} from '../src/worker-audio-draft.ts';
import {encodeWav} from '../src/audio.ts';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

const time=Date.parse('2026-10-07T12:00:00.000Z'),now=()=>time;
const session={authenticated:true,role:'worker',workerId:'qa-one',language:'en',mode:'synthetic-credential',clientContext:'a'.repeat(64),expiresAt:'2026-10-07T20:00:00.000Z'};
const scope={assignmentId:'one',publicationId:'published-v3',version:3,language:'en'};
const samples=Float32Array.from({length:16000},(_,i)=>Math.sin(i/10)*.5);
const bytes=encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples});

test('saved-audio limits and every control have complete localized non-delivery copy',()=>{
  assertWorkerDictionary(audioDraftCopy,'audioDraftCopy');
  assert.match(audioDraftCopy.en.privacy,/not a secure vault/);
  assert.match(audioDraftCopy.en.privacy,/Nothing uploads automatically/);
  assert.match(audioDraftCopy.en.failed,/No delivery is confirmed/);
});
const input=()=>({submissionId:crypto.randomUUID(),capturedAt:new Date(time).toISOString(),bytes:new Uint8Array(bytes)});
const failure=code=>error=>error instanceof AudioDraftError && error.code===code;
function memory(){
  let value=null;
  return {get value(){return value;},set value(next){value=next;},async read(){return structuredClone(value);},async replace(revision,next,allowed){if(!allowed() || (value?.revision ?? null)!==revision)return false;value=structuredClone(next);return true;},async clear(){value=null;}};
}
async function withoutPresentationId(envelope){
  const additionalData=new TextEncoder().encode(JSON.stringify(['understood-audio-draft-v1',envelope.revision,envelope.context]));
  const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(envelope.iv),additionalData},envelope.key,envelope.ciphertext));
  const length=new DataView(raw.buffer,raw.byteOffset).getUint32(0,true);
  const metadata=JSON.parse(new TextDecoder().decode(raw.slice(4,4+length)));delete metadata.presentationId;
  const encoded=new TextEncoder().encode(JSON.stringify(metadata));
  const packet=new Uint8Array(4+encoded.length+raw.length-4-length);
  new DataView(packet.buffer).setUint32(0,encoded.length,true);
  packet.set(encoded,4);packet.set(raw.slice(4+length),4+encoded.length);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},envelope.key,packet);
  return {...envelope,iv,ciphertext};
}
test('opt-in encrypted audio retains exact IDs/bytes across fresh reads with a nonextractable key and no plaintext metadata',async()=>{
  const store=memory(),original=input();
  await assert.rejects(saveAudioDraft(store,session,scope,original,false,()=>true,now),failure('invalid'));assert.equal(store.value,null);
  await saveAudioDraft(store,session,scope,original,true,()=>true,now);
  assert.equal(store.value.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',store.value.key));
  const raw=new TextDecoder().decode(store.value.ciphertext);for(const privateText of [scope.assignmentId,scope.publicationId,session.workerId,original.submissionId,original.capturedAt])assert.ok(!raw.includes(privateText));
  assert.deepEqual(Object.keys(store.value).sort(),['ciphertext','context','iv','key','revision']);
  const loaded=await readAudioDraft(store,session,scope,()=>true,now);assert.equal(loaded.status,'saved');assert.equal(loaded.draft.submissionId,original.submissionId);assert.equal(loaded.draft.expiresAt,session.expiresAt);assert.deepEqual(loaded.draft.bytes,bytes);
  loaded.draft.bytes.fill(0);assert.deepEqual((await readAudioDraft(store,session,scope,()=>true,now)).draft.bytes,bytes);
  assert.equal((await saveAudioDraft(store,session,scope,original,true,()=>true,now)).submissionId,original.submissionId);
  await clearAudioDraft(store,session.clientContext);assert.equal(store.value,null);
});
test('another recording or exact version cannot overwrite a saved payload or reveal it through a mismatched scope',async()=>{
  const store=memory(),original=input();await saveAudioDraft(store,session,scope,original,true,()=>true,now);
  for(const changed of [{...scope,assignmentId:'other'},{...scope,publicationId:'v4'},{...scope,version:4},{...scope,language:'ar'}]){
    assert.deepEqual(await readAudioDraft(store,session,changed,()=>true,now),{status:'other'});
    await assert.rejects(saveAudioDraft(store,session,changed,input(),true,()=>true,now),failure('other'));
  }
  await assert.rejects(saveAudioDraft(store,session,scope,input(),true,()=>true,now),failure('other'));
  const changed=new Uint8Array(bytes);changed[44]^=255;
  await assert.rejects(saveAudioDraft(store,session,scope,{...original,bytes:changed},true,()=>true,now),failure('invalid'));
  assert.equal((await readAudioDraft(store,session,scope,()=>true,now)).draft.submissionId,original.submissionId);
});
test('a translated-question binding is sealed with the recording, re-saves cannot change it, and legacy drafts read without one',async()=>{
  const store=memory(),original=input(),presentationId=crypto.randomUUID();
  const saved=await saveAudioDraft(store,session,scope,{...original,presentationId},true,()=>true,now);
  assert.equal(saved.presentationId,presentationId);
  assert.ok(!new TextDecoder().decode(store.value.ciphertext).includes(presentationId));
  assert.equal((await readAudioDraft(store,session,scope,()=>true,now)).draft.presentationId,presentationId);
  assert.equal((await saveAudioDraft(store,session,scope,{...original,presentationId},true,()=>true,now)).presentationId,presentationId);
  for(const changed of [crypto.randomUUID(),null]){
    await assert.rejects(saveAudioDraft(store,session,scope,{...original,presentationId:changed},true,()=>true,now),failure('invalid'));
  }
  assert.equal((await readAudioDraft(store,session,scope,()=>true,now)).draft.presentationId,presentationId);
  await assert.rejects(saveAudioDraft(memory(),session,scope,{...original,presentationId:'bad'},true,()=>true,now),failure('invalid'));

  const legacy=memory();
  await saveAudioDraft(legacy,session,scope,{...original,presentationId},true,()=>true,now);
  legacy.value=await withoutPresentationId(legacy.value);
  const loaded=await readAudioDraft(legacy,session,scope,()=>true,now);
  assert.equal(loaded.status,'saved');assert.equal(loaded.draft.presentationId,null);
  await assert.rejects(saveAudioDraft(legacy,session,scope,{...original,presentationId},true,()=>true,now),failure('invalid'));
});
test('foreign contexts, changed identities/languages/expiry and expired cache are purged without disclosure',async()=>{
  for(const changed of [{...session,clientContext:'b'.repeat(64)},{...session,workerId:'other'},{...session,language:'ar'},{...session,mode:'live'},{...session,expiresAt:'2026-10-07T21:00:00.000Z'}]){
    const store=memory();await saveAudioDraft(store,session,scope,input(),true,()=>true,now);
    assert.deepEqual(await readAudioDraft(store,changed,scope,()=>true,now),{status:'empty'});assert.equal(store.value,null);
  }
  const extended={...session,expiresAt:'2026-10-10T20:00:00.000Z'},store=memory();await saveAudioDraft(store,extended,scope,input(),true,()=>true,now);
  assert.equal((await readAudioDraft(store,extended,scope,()=>true,now)).draft.expiresAt,'2026-10-08T12:00:00.000Z');
  assert.deepEqual(await readAudioDraft(store,extended,scope,()=>true,()=>time+86400000),{status:'empty'});assert.equal(store.value,null);
  await assert.rejects(readAudioDraft(store,{...session,expiresAt:'2026-10-07T12:00:00.000Z'},scope,()=>true,now),failure('session'));
});
test('tampered envelopes, keys, ciphertext and invalid WAVs never restore or silently replace a draft',async()=>{
  for(const mutate of [value=>{value.context='b'.repeat(64);value.ciphertext=new ArrayBuffer(0);},value=>{new Uint8Array(value.ciphertext)[20]^=1;},value=>{value.iv[0]^=1;},value=>{value.revision=crypto.randomUUID();},value=>{value.extra='private';}]){
    const store=memory();await saveAudioDraft(store,session,scope,input(),true,()=>true,now);mutate(store.value);
    await assert.rejects(readAudioDraft(store,session,scope,()=>true,now),failure('invalid'));
    await assert.rejects(saveAudioDraft(store,session,scope,input(),true,()=>true,now),failure('invalid'));
  }
  for(const invalid of [{...input(),bytes:new Uint8Array(32044)},{...input(),bytes:new Uint8Array(0)},{...input(),submissionId:'bad'},{...input(),capturedAt:'2099-01-01T00:00:00.000Z'}])await assert.rejects(saveAudioDraft(memory(),session,scope,invalid,true,()=>true,now),failure('invalid'));
});
test('storage failure, discarded writes, competing saves and unsuccessful deletion never claim durable success',async()=>{
  await assert.rejects(saveAudioDraft({...memory(),read:async()=>{throw Error('blocked');}},session,scope,input(),true,()=>true,now),failure('storage'));
  await assert.rejects(saveAudioDraft({...memory(),replace:async()=>true},session,scope,input(),true,()=>true,now),failure('storage'));
  const store=memory();const results=await Promise.allSettled([saveAudioDraft(store,session,scope,input(),true,()=>true,now),saveAudioDraft(store,session,scope,input(),true,()=>true,now)]);
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(results.filter(value=>value.status==='rejected').length,1);
  const retained=structuredClone(store.value);await assert.rejects(clearAudioDraft({...store,clear:async()=>{} }),failure('storage'));assert.deepEqual(store.value,retained);
  await clearAudioDraft(store,'b'.repeat(64));assert.deepEqual(store.value,retained);
});
test('authority changes during async storage prevent disclosure/write and mutable input cannot alter the captured intent',async()=>{
  const store=memory(),mutable=input(),id=mutable.submissionId,capturedAt=mutable.capturedAt;
  const sourceRead=store.read;store.read=async()=>{mutable.bytes.fill(0);mutable.submissionId=crypto.randomUUID();mutable.capturedAt='2099-01-01T00:00:00.000Z';return sourceRead();};
  await saveAudioDraft(store,session,scope,mutable,true,()=>true,now);store.read=sourceRead;
  const loaded=await readAudioDraft(store,session,scope,()=>true,now);assert.equal(loaded.draft.submissionId,id);assert.equal(loaded.draft.capturedAt,capturedAt);assert.deepEqual(loaded.draft.bytes,bytes);
  let allowed=true;store.read=async()=>{allowed=false;return sourceRead();};
  await assert.rejects(readAudioDraft(store,session,scope,()=>allowed,now),failure('session'));
});
