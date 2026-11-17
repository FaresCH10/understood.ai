import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroqInstructionSpeech,groqSpeechChunks,vercelInstructionSpeech,normalizeGroqSpeech} from '../server/ai/groq-instruction-speech.mjs';
import {inspectWav} from '../server/audio.mjs';
const wav=()=>{const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);b.writeInt16LE(1000,44);return b;};
test('Groq speech splits at word boundaries, keeps all words, and returns one verified PCM track',async()=>{
 const text=('Keep the walkway clear. ').repeat(24).trim(),calls=[];let checks=0;
 const adapter=createGroqInstructionSpeech({apiKey:'fixture-secret',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.groq.com/openai/v1/audio/speech');calls.push(JSON.parse(options.body));return new Response(wav(),{headers:{'content-type':'audio/wav'}});}});
 const audio=await adapter.speech(text,'en',async()=>checks++);
 assert.ok(calls.length>1);assert.ok(calls.every(c=>c.input.length<=200&&c.voice==='austin'&&c.model==='canopylabs/orpheus-v1-english'));
 assert.equal(calls.map(c=>c.input).join(' '),text);assert.equal(inspectWav(audio).durationSeconds,calls.length);assert.ok(checks>=calls.length*2);
 calls.length=0;await adapter.speech('أبق الممر خالياً.','ar');assert.equal(calls[0].voice,'fahad');assert.equal(calls[0].model,'canopylabs/orpheus-arabic-saudi');
 await assert.rejects(adapter.speech('Привет мир.','ru'),/English and Arabic/);
 assert.throws(()=>groqSpeechChunks('x'.repeat(201)),/word longer/);assert.throws(()=>groqSpeechChunks('x'.repeat(1001)),/1000/);
 assert.doesNotMatch(JSON.stringify(adapter),/fixture-secret/);assert.equal(vercelInstructionSpeech({}),undefined);
 for(const patch of [{UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH:'invalid'},{VERCEL_ENV:'preview'},{UNDERSTOOD_TIER:'production'},{GROQ_API_KEY:''}])assert.throws(()=>vercelInstructionSpeech({VERCEL_ENV:'production',UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH:'groq',GROQ_API_KEY:'fixture',...patch}));
});
test('speech failures, oversized/corrupt audio and revoked authority never produce usable audio',async()=>{
 for(const response of [new Response('busy',{status:429}),new Response('not a wav'),new Response(Buffer.alloc(5000000))]){
  const adapter=createGroqInstructionSpeech({apiKey:'fixture',fetchImpl:async()=>response});await assert.rejects(adapter.speech('Keep the walkway clear.','en'));
 }
 let calls=0;const adapter=createGroqInstructionSpeech({apiKey:'fixture',fetchImpl:async()=>{calls++;return new Response(wav());}});
 await assert.rejects(adapter.speech('Keep the walkway clear.','en',async()=>{throw Error('Authority changed');}),/Authority/);assert.equal(calls,0);
});


test('Groq streamed WAV metadata and unknown RIFF/data lengths normalize to standard private audio',()=>{
 const original=wav(),header=Buffer.from(original.subarray(0,12)),format=original.subarray(12,36),list=Buffer.from([76,73,83,84,4,0,0,0,73,78,70,79]),data=Buffer.alloc(8);
 header.writeUInt32LE(0xffffffff,4);data.write('data');data.writeUInt32LE(0xffffffff,4);
 const streamed=Buffer.concat([header,format,list,data,original.subarray(44)]);
 assert.deepEqual(normalizeGroqSpeech(streamed),original);
 assert.throws(()=>normalizeGroqSpeech(streamed.subarray(0,streamed.length-1)),/WAV/);
 const corrupt=Buffer.from(streamed);corrupt.writeUInt32LE(99999999,40);assert.throws(()=>normalizeGroqSpeech(corrupt),/WAV/);
});
