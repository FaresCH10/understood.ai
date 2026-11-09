import test from 'node:test';
import assert from 'node:assert/strict';
import {createNemotronAdapter,NEMOTRON_ULTRA_MODEL} from '../server/ai/nemotron.mjs';
import {resolvePreparationAdapter,preparationInputHash} from '../server/ai/preparation-config.mjs';
import {pipelineStatus} from '../server/ai/pipeline-status.mjs';
import {GEMINI_MODELS} from '../server/ai/gemini.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';

const hash='a'.repeat(64),apiKey='test-only-nvidia-key';
const journal=()=>{const calls=[];return {calls,async beforeRequest(){calls.push('request');return String(calls.length);},async afterRequest(id,meta){calls.push(meta.httpStatus);}}};
const answer='Put finished items on the blue shelf. Put unfinished items on the yellow shelf. Leave the walkway clear.';
const facts=['Put finished items on the blue shelf.','Put unfinished items on the yellow shelf.','Leave the walkway clear.'];
const question='Are finished items on the blue shelf, unfinished items on the yellow shelf, and the walkway clear?';
const translationInput={title:'Shelf routing',text:answer,question};
const hindi={title:'शेल्फ़ वितरण',text:'तैयार वस्तुओं को नीली शेल्फ़ पर रखें। अधूरी वस्तुओं को पीली शेल्फ़ पर रखें। रास्ता खुला रखें।',question:'क्या तैयार वस्तुएँ नीली शेल्फ़ पर, अधूरी वस्तुएँ पीली शेल्फ़ पर हैं और रास्ता खुला है?'};
const translationCheck={faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};
const reply=(value,{finish='stop'}={})=>Response.json({choices:[{finish_reason:finish,message:{content:typeof value==='string'?value:JSON.stringify(value)}}]});
const preparation={title:'Shelf routing',facts,question,askedFacts:facts};
const choices=['Finished items on the blue shelf, unfinished items on the yellow shelf, walkway clear.',
  'Finished items on the yellow shelf, unfinished items on the blue shelf, walkway clear.',
  'Finished items on the blue shelf, unfinished items on the yellow shelf, walkway blocked.',
  'Finished items on the blue shelf, unfinished items in storage, walkway clear.'];
const grounding={sourceGrounded:true,questionAligned:true,ambiguous:false,
  factEvidence:facts.map((quote,factIndex)=>({factIndex,quote})),askedFactIndexes:[0,1,2],reasons:[]};

test('Nemotron adapter is synthetic-only and validates model, key and journal contracts',async()=>{
  assert.throws(()=>createNemotronAdapter({dataClass:'synthetic'}),/credentials/i);
  assert.throws(()=>createNemotronAdapter({apiKey,dataClass:'real'}),/synthetic/);
  assert.throws(()=>createNemotronAdapter({apiKey:'bad key',dataClass:'synthetic'}),/credentials/);
  assert.throws(()=>createNemotronAdapter({apiKey,dataClass:'synthetic',textModel:'Bad Model'}),/model/i);
  assert.throws(()=>createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:{}}),/journal/i);
  const adapter=createNemotronAdapter({apiKey,dataClass:'synthetic',fetchImpl:async()=>reply(preparation)});
  assert.ok(Object.isFrozen(adapter.provenance));
  assert.equal(adapter.provenance.adapter,'nemotron-text-v1');
  assert.equal(adapter.provenance.textModel,NEMOTRON_ULTRA_MODEL);
  assert.equal(adapter.transcribe,undefined);assert.equal(adapter.speech,undefined);assert.equal(adapter.assess,undefined);
  assert.doesNotMatch(JSON.stringify(adapter),/test-only/);
});

test('Nemotron preparation, grounding, translation and translation checks honor the NIM contract',async()=>{
  const calls=[],requests=journal();
  const adapter=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:requests,fetchImpl:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    if(calls.length===1)return reply(preparation);
    if(calls.length===2)return reply(grounding);
    if(calls.length===3)return reply(hindi);
    return reply(translationCheck);
  }});
  assert.deepEqual(await adapter.prepare(answer),preparation);
  assert.deepEqual(await adapter.checkPreparation(answer,preparation),grounding);
  assert.deepEqual(await adapter.translate(translationInput,'hi',{terms:[{term:'walkway',translation:'रास्ता'}]}),hindi);
  assert.deepEqual(await adapter.checkTranslation(translationInput,hindi,'hi',{terms:[{term:'walkway',translation:'रास्ता'}]}),translationCheck);
  assert.equal(calls.length,4);
  assert.ok(calls.every(call=>call.url==='https://integrate.api.nvidia.com/v1/chat/completions'));
  assert.ok(calls.every(call=>call.body.model===NEMOTRON_ULTRA_MODEL));
  assert.ok(calls.every(call=>call.body.chat_template_kwargs?.enable_thinking===false));
  assert.ok(calls.every(call=>call.body.temperature===0&&call.body.response_format===undefined));
  assert.match(calls[2].body.messages[0].content,/Hindi.*Devanagari/);
  assert.deepEqual(requests.calls,[ 'request',200,'request',200,'request',200,'request',200 ]);

  const latin=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),
    fetchImpl:async()=>reply({title:'Shelf routing',text:answer,question})});
  await assert.rejects(()=>latin.translate(translationInput,'hi'),/translation failed validation/);
  const malformed=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply('not json')});
  await assert.rejects(()=>malformed.prepare(answer),/malformed/);
  const truncated=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply(preparation,{finish:'length'})});
  await assert.rejects(()=>truncated.prepare(answer),/incomplete/);
  const wrong=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async()=>reply(hindi)});
  await assert.rejects(()=>wrong.translate(translationInput,'xx'),/Unsupported target language/);
});

test('Nemotron instruction preparation supports four grounded answer choices',async()=>{
  const calls=[];
  const adapter=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    return calls.length===1?reply({...preparation,choices}):reply({...grounding,choicesAligned:true});
  }});
  assert.deepEqual(await adapter.prepare(answer,{multipleChoice:true}),{...preparation,choices});
  assert.match(calls[0].messages[0].content,/exactly four short plausible answers/);
  assert.deepEqual(await adapter.checkPreparation(answer,{...preparation,choices}),{...grounding,choicesAligned:true});
  assert.match(calls[1].messages[0].content,/choicesAligned/);
  const duplicate=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),
    fetchImpl:async()=>reply({...preparation,choices:[...choices.slice(0,3),choices[0]]})});
  await assert.rejects(()=>duplicate.prepare(answer,{multipleChoice:true}),/answer choices/);
  const unaligned=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),
    fetchImpl:async()=>reply({...grounding,choicesAligned:false})});
  assert.equal((await unaligned.checkPreparation(answer,{...preparation,choices})).choicesAligned,false);
});

test('Nemotron translates instruction answer choices in their original order',async()=>{
  const calls=[];
  const bengali={title:'আইটেম প্লেসমেন্ট এবং ওয়াকওয়ে নিয়ম',
    text:'সম্পন্ন আইটেমগুলো নীল শেলফে রাখুন। অসম্পন্ন আইটেমগুলো হলুদ শেলফে রাখুন। ওয়াকওয়ে খালি রাখুন।',
    question:'সম্পন্ন আইটেমগুলো কোথায় রাখতে হবে, অসম্পন্ন আইটেমগুলো কোথায় রাখতে হবে, এবং ওয়াকওয়ে নিয়ে কী করতে হবে?',
    answerChoices:['নীল শেলফে','হলুদ শেলফে','লাল শেলফে','সবুজ শেলফে']};
  const adapter=createNemotronAdapter({apiKey,dataClass:'synthetic',requestJournal:journal(),fetchImpl:async(url,options)=>{
    calls.push(JSON.parse(options.body));
    return calls.length===1?reply(bengali):reply(translationCheck);
  }});
  const input={...translationInput,answerChoices:choices};
  assert.deepEqual(await adapter.translate(input,'bn'),bengali);
  assert.deepEqual(JSON.parse(calls[0].messages[1].content).content.answerChoices,choices);
  assert.match(calls[0].messages[0].content,/Also return answerChoices/);
  assert.deepEqual(await adapter.checkTranslation(input,bengali,'bn'),translationCheck);
  assert.deepEqual(JSON.parse(calls[1].messages[1].content).translation.answerChoices,bengali.answerChoices);
});

test('nemotron-gemini preparation uses Nemotron text with Gemini speech and exact allowlisting',()=>{
  const env={UNDERSTOOD_PREPARATION_ADAPTER:'nemotron-gemini',UNDERSTOOD_TIER:'local',UNDERSTOOD_AI_MODE:'synthetic',
    UNDERSTOOD_ACCESS_MODE:'credential',UNDERSTOOD_DATA_CLASS:'synthetic',GEMINI_API_KEY:'test-only-gemini',
    NVIDIA_API_KEY:apiKey,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([hash])};
  const input={source:answer,revision:1,languages:['en'],review:null,glossary:{revision:0,hash:'empty',terms:[]}};
  const adapter=resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)])},{fetchImpl:async()=>assert.fail('No dispatch')});
  assert.equal(adapter.provenance.adapter,'nemotron-gemini-bundle-v1');assert.equal(adapter.provenance.textModel,NEMOTRON_ULTRA_MODEL);
  assert.equal(adapter.provenance.speechModel,GEMINI_MODELS.speech);assert.deepEqual(adapter.capabilities.speechLanguages,WORKER_LANGUAGE_CODES);
  assert.equal(adapter.permitsPreparation(input),true);assert.equal(adapter.permitsPreparation({...input,revision:2}),false);
  for(const key of ['prepare','checkPreparation','translate','checkTranslation','speech'])assert.equal(typeof adapter[key],'function');
  assert.equal(JSON.stringify(adapter).includes('test-only'),false);
  const status=pipelineStatus({preparationAdapter:adapter});
  const preparationStage=status.stages.find(stage=>stage.id==='preparation');
  assert.equal(preparationStage.configuration,'configured');
  assert.deepEqual(preparationStage.models,[NEMOTRON_ULTRA_MODEL]);
  assert.match(preparationStage.evidence,/nvidia\/nemotron-3-ultra/i);
  for(const patch of [{UNDERSTOOD_PREPARATION_ADAPTER:'other'},{NVIDIA_API_KEY:''},{GEMINI_API_KEY:''},{UNDERSTOOD_DATA_CLASS:'real'},{UNDERSTOOD_AI_MODE:'live'}])
    assert.throws(()=>resolvePreparationAdapter({...env,UNDERSTOOD_SYNTHETIC_PREPARATION_HASHES:JSON.stringify([preparationInputHash(input)]),...patch},{fetchImpl:async()=>assert.fail('No dispatch')}));
});
