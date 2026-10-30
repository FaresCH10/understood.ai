import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inspectWav} from '../server/audio.mjs';
import {createLocalSourceTranscriber} from '../server/ai/local-source-transcription.mjs';
import {resolveSourceTranscription} from '../server/ai/source-transcription-config.mjs';
function sample(){const bytes=Buffer.alloc(32044);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);bytes.writeInt16LE(1000,44);return bytes;}
const env={UNDERSTOOD_SOURCE_TRANSCRIPTION:'gemini-local',UNDERSTOOD_LOCAL_REAL_AUDIO_APPROVED:'true',UNDERSTOOD_TIER:'local',UNDERSTOOD_ACCESS_MODE:'credential',GEMINI_API_KEY:'local-test-key'};
test('real local transcription requires explicit opt-in and does not enable hosted or synthetic adapters',()=>{
 for(const change of [{UNDERSTOOD_LOCAL_REAL_AUDIO_APPROVED:'false'},{UNDERSTOOD_TIER:'production'},{UNDERSTOOD_ACCESS_MODE:'demo'},{GEMINI_API_KEY:''}])assert.throws(()=>resolveSourceTranscription({...env,...change}));
 const adapter=resolveSourceTranscription(env);assert.equal(adapter.provenance.dataClass,'real');assert.equal(adapter.prepare,undefined);assert.equal(adapter.assess,undefined);assert.equal(adapter.speech,undefined);assert.equal(adapter.withJournal,undefined);
 assert.equal(resolveSourceTranscription({}),undefined);
});
test('local source transcription sends only canonical audio to Gemini, ignores thoughts, and bounds attempts',async()=>{
 const audio=sample(),row={request_id:randomUUID(),org_id:'org',site_id:'site',requested_by:'owner',attempts:1,...inspectWav(audio)};let calls=0;
 const adapter=createLocalSourceTranscriber({apiKey:'local-test-key',approved:true,paceRequest:async()=>{},fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');assert.equal(options.redirect,'error');assert.ok(options.signal);const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[0].inlineData.data,audio.toString('base64'));assert.ok(!options.body.includes('owner'));assert.ok(!options.body.includes('org'));
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'Internal thought'},{text:'Keep the walkway clear.'}]}}]});
 }});
 assert.equal((await adapter.transcribe(audio,'audio/wav',row)).text,'Keep the walkway clear.');
 await assert.rejects(adapter.transcribe(audio,'audio/wav',{...row,attempts:4}),/claimed source/);
 await assert.rejects(adapter.transcribe(audio,'audio/wav',{...row,sha256:'a'.repeat(64)}),/changed/);
 await assert.rejects(adapter.transcribe(audio,'audio/mp3',row),/claimed source/);assert.equal(calls,1);
});
test('local transcription rejects blocked, empty, excessive and failed provider responses',async()=>{
 const audio=sample(),row={request_id:randomUUID(),org_id:'org',site_id:'site',requested_by:'owner',attempts:1,...inspectWav(audio)};
 for(const response of [()=>Response.json({candidates:[{finishReason:'SAFETY'}]}),()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:''}]}}]}),()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'x'.repeat(4001)}]}}]}),()=>new Response('Quota',{status:429}),()=>new Response('x'.repeat(128*1024+1))]){
  const adapter=createLocalSourceTranscriber({apiKey:'local-test-key',approved:true,paceRequest:async()=>{},fetchImpl:async()=>response()});await assert.rejects(adapter.transcribe(audio,'audio/wav',row));
 }
});
