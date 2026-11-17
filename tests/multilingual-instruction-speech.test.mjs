import test from 'node:test';
import assert from 'node:assert/strict';
import {createAzureInstructionSpeech,AZURE_INSTRUCTION_VOICES} from '../server/ai/azure-instruction-speech.mjs';
import {vercelInstructionSpeech,createPunjabiSpeechConversion} from '../server/ai/instruction-speech.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
import {instructionVoiceBundle} from '../server/ai/instruction-voice-bundle.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';
import {withMultipleChoice} from '../server/multiple-choice.mjs';
import {createHash} from 'node:crypto';
import {checkAzureVoices} from '../scripts/vercel-azure-voice-check.mjs';

const wav=()=>{const b=Buffer.alloc(32044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);b.writeInt16LE(1000,44);return b;};
const good={faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};
const env={VERCEL_ENV:'production',UNDERSTOOD_VERCEL_INSTRUCTION_SPEECH:'groq-azure',GROQ_API_KEY:'fixture-groq',AZURE_SPEECH_KEY:'fixture-azure',AZURE_SPEECH_REGION:'eastus',NVIDIA_API_KEY:'fixture-nvidia'};

test('Azure build check is opt-in, covers 13 routes, and never logs keys or source content',async()=>{
 let calls=0;await checkAzureVoices({env:{},fetchImpl:async()=>{calls++;throw Error('Must not call');}});assert.equal(calls,0);
 const logs=[];await checkAzureVoices({env:{...env,UNDERSTOOD_AZURE_VERIFY_BUILD:'1'},log:line=>logs.push(line),fetchImpl:async(url,options)=>{
   calls++;
   if(url.endsWith('/voices/list'))return Response.json(Object.values(AZURE_INSTRUCTION_VOICES).map(ShortName=>({ShortName})));
   if(url.includes('nvidia')){
     const check=JSON.parse(options.body).messages[0].content.includes('Independently compare');
     return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(check?good:{title:'ਪੰਜਾਬੀ',text:'ਰਸਤਾ ਸਾਫ਼ ਰੱਖੋ।',question:'ਰਸਤਾ ਸਾਫ਼ ਰੱਖੋ।'})}}]});
   }
   return new Response(wav());
 }});
 assert.equal(calls,16);assert.equal(logs.length,14);assert.doesNotMatch(logs.join('\n'),/fixture-|راستہ|ਰਸਤਾ/);
 await assert.rejects(checkAzureVoices({env:{UNDERSTOOD_AZURE_VERIFY_BUILD:'1'}}),/requires/);
});

test('all 15 locales route to their provider; Shahmukhi conversion is checked and original text is not modified',async()=>{
 const calls=[];const fetchImpl=async(url,options)=>{
   calls.push({url,options});
   if(url.includes('nvidia')){
     const check=JSON.parse(options.body).messages[0].content.includes('Independently compare');
     return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(check?good:{title:'ਪੰਜਾਬੀ',text:'ਰਸਤਾ ਖਾਲੀ ਰੱਖੋ।',question:'ਰਸਤਾ ਖਾਲੀ ਰੱਖੋ।'})}}]});
   }
   return new Response(wav());
 };
 const speech=vercelInstructionSpeech(env,fetchImpl);
 assert.deepEqual(new Set(speech.languages),new Set(WORKER_LANGUAGE_CODES));
 for(const language of WORKER_LANGUAGE_CODES){
   const input=language==='pa-Arab'?'راستہ خالی رکھو۔':'Keep the walkway clear.';
   assert.deepEqual(await speech.speech(input,language),wav());
 }
 assert.equal(calls.filter(c=>c.url.includes('groq')).length,2);
 const azure=calls.filter(c=>c.url.includes('microsoft'));assert.equal(azure.length,13);
 for(const voice of Object.values(AZURE_INSTRUCTION_VOICES))assert.ok(azure.some(c=>c.options.body.includes(`name="${voice}"`)));
 assert.ok(azure.some(c=>c.options.body.includes('ਰਸਤਾ ਖਾਲੀ ਰੱਖੋ।')));
 assert.ok(azure.every(c=>!c.options.body.includes('راستہ')));
 assert.doesNotMatch(JSON.stringify(speech),/fixture-/);
});

test('Azure escapes SSML, bounds audio, and never returns revoked or failed speech',async()=>{
 let calls=0,body;const adapter=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',fetchImpl:async(url,options)=>{calls++;body=options.body;return new Response(wav());}});
 await adapter.speech('Use <voice> & "text".','ru');assert.match(body,/&lt;voice&gt; &amp; &quot;text&quot;/);
 await assert.rejects(adapter.speech('text','pa-Arab'),/unavailable/);
 await assert.rejects(adapter.speech('text','ru',async()=>{throw Error('Revoked');}),/Revoked/);assert.equal(calls,1);
 let checks=0;await assert.rejects(adapter.speech('text','ru',async()=>{if(++checks===3)throw Error('Revoked');}),/Revoked/);
 for(const response of [new Response('no',{status:401}),new Response('invalid'),new Response(Buffer.alloc(3000000))]){
   const a=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',fetchImpl:async()=>response});
   await assert.rejects(a.speech('text','si'));
 }
 assert.throws(()=>createAzureInstructionSpeech({apiKey:'fixture',region:'eastus.evil.test/path'}),/region/);
});

test('Punjabi failed validation or authority change prevents narration',async()=>{
 const conversion=createPunjabiSpeechConversion({translate:async()=>({title:'ਪੰਜਾਬੀ',text:'ਰਸਤਾ',question:'ਰਸਤਾ'}),checkTranslation:async()=>({...good,faithful:false})});
 let calls=0;const adapter=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',shahmukhiToGurmukhi:conversion,fetchImpl:async()=>{calls++;return new Response(wav());}});
 await assert.rejects(adapter.speech('راستہ','pa-Arab'),{code:'translation_check_failed'});assert.equal(calls,0);
 const invalid=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',shahmukhiToGurmukhi:async()=> 'راستہ',fetchImpl:async()=>{calls++;return new Response(wav());}});
 await assert.rejects(invalid.speech('راستہ','pa-Arab'),/conversion/);assert.equal(calls,0);
});

test('Azure free-tier throttling waits once, rechecks authority, and bounds retries',async()=>{
 let calls=0,waited=0,checks=0;
 const adapter=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',sleep:async ms=>{waited+=ms;},fetchImpl:async()=>++calls===1?new Response('throttled',{status:429,headers:{'retry-after':'60'}}):new Response(wav())});
 assert.deepEqual(await adapter.speech('रास्ता साफ रखें।','hi',async()=>{checks++;}),wav());
 assert.equal(calls,2);assert.equal(waited,60000);assert.ok(checks>=15);
 calls=0;
 const revoked=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',sleep:async()=>{},fetchImpl:async()=>{calls++;return new Response('throttled',{status:429});}});
 let authority=0;await assert.rejects(revoked.speech('रास्ता','hi',async()=>{if(++authority===4)throw Error('Revoked');}),/Revoked/);assert.equal(calls,1);
 calls=0;const exhausted=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',sleep:async()=>{},fetchImpl:async()=>{calls++;return new Response('throttled',{status:429,headers:{'retry-after':'1'}});}});
 await assert.rejects(exhausted.speech('रास्ता','hi'),/429/);assert.equal(calls,2);
 const longRetry=createAzureInstructionSpeech({apiKey:'fixture',region:'eastus',sleep:async()=>assert.fail('Must not wait beyond lease'),fetchImpl:async()=>new Response('throttled',{status:429,headers:{'retry-after':'300'}})});
 await assert.rejects(longRetry.speech('रास्ता','hi'),/429/);
});

test('new configuration preserves Groq when Azure is absent and keeps live-tier admission separate',()=>{
 const {AZURE_SPEECH_KEY,AZURE_SPEECH_REGION,...withoutAzure}=env;
 assert.deepEqual(vercelInstructionSpeech(withoutAzure).languages,['en','ar']);
 assert.throws(()=>vercelInstructionSpeech({...env,AZURE_SPEECH_REGION:''}),/region/);
 assert.throws(()=>vercelInstructionSpeech({...env,VERCEL_ENV:'preview'}));
 assert.throws(()=>vercelInstructionSpeech({...env,UNDERSTOOD_TIER:'production'}));
 const {NVIDIA_API_KEY,...withoutConversion}=env;
 assert.equal(vercelInstructionSpeech(withoutConversion).languages.includes('pa-Arab'),false);
});

test('multilingual bundle preserves all displayed scripts and frozen choices in private audio manifests',async()=>{
 const prepared=withMultipleChoice(syntheticPrepare(CANONICAL_SOURCE)),calls=[];
 prepared.rubric.askedFacts=prepared.facts.slice(0,2);
 const speech={languages:WORKER_LANGUAGE_CODES,provenance:{adapter:'nemotron-multilingual-voice-v1',speechModel:'orpheus/azure-neural',voice:'locale-neural-voices'},async speech(text,language){calls.push({text,language});return wav();}};
 const glossary={revision:0,hash:createHash('sha256').update('[]').digest('hex'),terms:[]};
 const bundle=await instructionVoiceBundle(prepared,{source:CANONICAL_SOURCE,title:prepared.title,revision:1,review:null,glossary,responseMode:'question'},speech,async()=>{});
 assert.equal(bundle.audio.length,30);assert.equal(calls.length,30);
 assert.deepEqual(bundle.manifest.languages['pa-Arab'].text,prepared.languages['pa-Arab'].text);
 assert.equal(bundle.manifest.provenance.speechModel,'orpheus/azure-neural');
 for(const language of WORKER_LANGUAGE_CODES){
   const content=bundle.manifest.languages[language];assert.deepEqual(content.choices,prepared.languages[language].choices);
   assert.equal(content.speech.question.includesChoices,true);
 }
});
