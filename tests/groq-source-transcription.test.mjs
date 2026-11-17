import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWav} from '../server/audio.mjs';
import {createGroqSourceTranscriber,vercelSourceTranscription} from '../server/ai/groq-source-transcription.mjs';
const wav=()=>{const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);b.writeInt16LE(1000,44);return b;};
const row=bytes=>({request_id:'request',org_id:'org',site_id:'site',requested_by:'owner',attempts:1,...inspectWav(bytes)});
test('Groq transcribes canonical claimed audio in its original language without translation',async()=>{
 const bytes=wav();let calls=0;
 const adapter=createGroqSourceTranscriber({apiKey:'fixture-secret',fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(options.body.get('model'),'whisper-large-v3');assert.equal(options.body.get('language'),null);assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()),bytes);return Response.json({text:'ضع العناصر المكتملة على الرف الأزرق.'});}});
 assert.equal((await adapter.transcribe(bytes,'audio/wav',row(bytes))).text,'ضع العناصر المكتملة على الرف الأزرق.');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(adapter),/fixture-secret/);
 await assert.rejects(adapter.transcribe(bytes,'audio/wav',{...row(bytes),sha256:'bad'}),/changed/);assert.equal(calls,1);
 await assert.rejects(adapter.transcribe(bytes,'audio/wav',null),/claimed/);
 assert.equal(vercelSourceTranscription({}),undefined);
 for(const patch of [{UNDERSTOOD_VERCEL_SOURCE_TRANSCRIPTION:'unknown'},{VERCEL_ENV:'preview'},{UNDERSTOOD_TIER:'production'},{GROQ_API_KEY:''}])assert.throws(()=>vercelSourceTranscription({VERCEL_ENV:'production',UNDERSTOOD_VERCEL_SOURCE_TRANSCRIPTION:'groq',GROQ_API_KEY:'fixture',...patch}));
});
test('Groq rejects failed, empty, truncated and oversized transcripts',async()=>{
 const bytes=wav();for(const response of [new Response('not JSON'),Response.json({text:''}),Response.json({text:'x'.repeat(4001)}),new Response('x'.repeat(128*1024+1)),new Response('unavailable',{status:429})]){
  const adapter=createGroqSourceTranscriber({apiKey:'fixture',fetchImpl:async()=>response});await assert.rejects(adapter.transcribe(bytes,'audio/wav',row(bytes)));
 }
});
